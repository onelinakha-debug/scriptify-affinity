const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const core = require('./core');
const {
  DEFAULT_REPO, getTextContent, parseTitles, getImageDataUrl,
  parseScriptMetadata, safeFilename, upsertMetadataHeader, fetchFresh
} = core;

const SERVER_URL = 'http://localhost:6767/sse';

const AI_DEFAULTS = {
  aiProvider: 'anthropic',
  aiModel: 'claude-sonnet-4-5',
  aiBaseUrl: '',
  apiKeyEncrypted: ''
};

const UI_DEFAULTS = {
  previewOnRun: true,
  previewZoom: 'fit'
};

let localScriptsDir;
let docsCacheDir;
let configPath;
let win;
let watchEnabled = true;
const affinity = core.createAffinity(SERVER_URL, 'scriptify-affinity', app.getVersion());

// ---- shared core: pure helpers + Affinity client live in core.js ----
// (getTextContent, parseTitles, getImageDataUrl, metadata + filename helpers,
// fetchFresh are destructured from core at the top of this file)

function getConfig() {
  return core.getConfig(configPath, { ...AI_DEFAULTS, ...UI_DEFAULTS });
}

function saveConfig(config) {
  return core.saveConfig(configPath, config);
}

async function ensureMcpConnected() {
  return affinity.ensureConnected();
}

async function callTool(name, args) {
  return affinity.callTool(name, args);
}

// ---- watch mode: auto re-push installed scripts on save ----
const pendingPush = new Map();
function startWatcher() {
  try {
    const watcher = fsSync.watch(localScriptsDir);
    watcher.on('change', (eventType, filename) => {
      if (!watchEnabled || !filename || !filename.endsWith('.js')) return;
      if (pendingPush.has(filename)) clearTimeout(pendingPush.get(filename));
      pendingPush.set(filename, setTimeout(() => handleWatchChange(filename), 400));
    });
    watcher.on('error', (e) => console.warn('[watch] error:', e.message));
  } catch (e) {
    console.warn('[watch] failed to start:', e.message);
  }
}

async function handleWatchChange(filename) {
  pendingPush.delete(filename);
  const full = path.join(localScriptsDir, path.basename(filename));
  try { await fs.stat(full); } catch { return; }
  // Always tell the GUI the library changed (covers agent/CLI saves too).
  if (win && !win.isDestroyed()) win.webContents.send('library-changed', { file: filename });
  try {
    const listRes = await callTool('list_library_scripts', {});
    const titles = parseTitles(listRes).map((t) => t.toLowerCase());
    const code = await fs.readFile(full, 'utf8');
    const meta = parseScriptMetadata(code, path.parse(filename).name);
    const title = meta.name || path.parse(filename).name;
    // Only auto-sync if already installed — new files stay local until Install.
    if (!titles.includes(title.toLowerCase()) && !titles.includes(path.parse(filename).name.toLowerCase())) return;
    await callTool('save_script_to_library', { title, description: meta.description || '', code });
    if (win && !win.isDestroyed()) win.webContents.send('watch-push', { file: filename, success: true, title });
  } catch (e) {
    if (win && !win.isDestroyed()) win.webContents.send('watch-push', { file: filename, success: false, error: e.message });
  }
}

// ---- app ----
app.whenReady().then(async () => {
  localScriptsDir = path.join(app.getPath('userData'), 'MyScripts');
  docsCacheDir = path.join(__dirname, 'docs-cache');
  configPath = path.join(app.getPath('userData'), 'config.json');
  await fs.mkdir(localScriptsDir, { recursive: true });
  await fs.mkdir(docsCacheDir, { recursive: true });

  ensureMcpConnected().catch((e) => console.warn('[MCP] initial connect failed:', e.message));

  win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Scriptify Affinity',
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'brand assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile('index.html');
  startWatcher();

  ipcMain.handle('mcp-status', async () => {
    try {
      await ensureMcpConnected();
      return { success: true, connected: true, url: SERVER_URL };
    } catch (e) {
      return { success: false, connected: false, url: SERVER_URL, error: e.message };
    }
  });

  ipcMain.handle('list-local-scripts', async () => {
    try {
      const files = (await fs.readdir(localScriptsDir)).filter((f) => f.endsWith('.js'));
      const out = [];
      for (const file of files) {
        const full = path.join(localScriptsDir, file);
        const stat = await fs.stat(full);
        let meta = { name: path.parse(file).name, description: '', version: '' };
        try {
          const head = (await fs.readFile(full, 'utf8')).slice(0, 4096);
          meta = parseScriptMetadata(head, meta.name);
        } catch {}
        out.push({ file, ...meta, size: stat.size, modified: stat.mtimeMs });
      }
      return { success: true, data: out };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('read-local-script', async (_e, filename) => {
    try {
      const code = await fs.readFile(path.join(localScriptsDir, filename), 'utf8');
      return { success: true, data: { code } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-local-script', async (_e, filename, code) => {
    try {
      const safe = path.basename(filename);
      if (!safe.endsWith('.js')) throw new Error('Filename must end with .js');
      await fs.writeFile(path.join(localScriptsDir, safe), code, 'utf8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('list-mcp-scripts', async () => {
    try {
      const res = await callTool('list_library_scripts', {});
      return { success: true, data: parseTitles(res) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('push-to-mcp', async (_e, filename) => {
    try {
      const code = await fs.readFile(path.join(localScriptsDir, path.basename(filename)), 'utf8');
      const meta = parseScriptMetadata(code, path.parse(filename).name);
      await callTool('save_script_to_library', {
        title: meta.name || path.parse(filename).name,
        description: meta.description || '',
        code
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('download-from-mcp', async (_e, title) => {
    try {
      const res = await callTool('read_library_script', { title });
      const code = getTextContent(res);
      if (!code) return { success: false, error: 'Empty script returned.' };
      await fs.writeFile(path.join(localScriptsDir, safeFilename(title)), code, 'utf8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('execute-script', async (_e, code) => {
    try {
      const res = await callTool('execute_script', { script: code });
      return { success: true, output: getTextContent(res) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-watch', async () => ({ success: true, enabled: watchEnabled }));
  ipcMain.handle('set-watch', async (_e, enabled) => {
    watchEnabled = Boolean(enabled);
    return { success: true, enabled: watchEnabled };
  });

  ipcMain.handle('fetch-docs', async () => {
    try {
      const listRes = await callTool('list_sdk_documentation', {});
      const raw = getTextContent(listRes).trim();
      if (!raw || /^error[:\s]/i.test(raw)) {
        return { success: false, error: 'Affinity returned no topic list: ' + (raw || 'empty') };
      }
      const topics = parseTitles(listRes).filter((t) => t && !/^error/i.test(t) && t !== 'preamble');
      const docs = [];
      for (const topic of topics) {
        try {
          const r = await callTool('read_sdk_documentation_topic', { filename: topic });
          const content = getTextContent(r);
          if (!content || /^error[:\s]/i.test(content.trim())) continue;
          docs.push({ title: topic, content });
          const safe = topic.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) + '.md';
          await fs.writeFile(path.join(docsCacheDir, safe), `# ${topic}\n\n${content}\n`, 'utf8').catch(() => {});
        } catch {}
      }
      return { success: true, data: docs };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('search-docs', async (_e, query) => {
    try {
      const res = await callTool('search_sdk_hints', { prompt: String(query || '') });
      return { success: true, data: getTextContent(res) || JSON.stringify(res) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ---- Phase 3: local file actions ----
  ipcMain.handle('delete-local-script', async (_e, filename) => {
    try {
      await fs.unlink(path.join(localScriptsDir, path.basename(filename)));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('rename-local-script', async (_e, filename, newName) => {
    try {
      const from = path.join(localScriptsDir, path.basename(filename));
      const clean = String(newName || '').trim().replace(/\.js$/i, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
      if (!clean) throw new Error('Enter a valid name.');
      const to = path.join(localScriptsDir, `${clean}.js`);
      try { await fs.access(to); return { success: false, error: `A script named ${clean}.js already exists.` }; } catch {}
      await fs.rename(from, to);
      return { success: true, data: { filename: `${clean}.js` } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('update-script-meta', async (_e, filename, meta) => {
    try {
      const full = path.join(localScriptsDir, path.basename(filename));
      const code = await fs.readFile(full, 'utf8');
      const next = upsertMetadataHeader(code, {
        name: meta.name || '',
        description: meta.description || '',
        version: meta.version || '',
        author: meta.author || ''
      });
      await fs.writeFile(full, next, 'utf8');
      return { success: true, data: parseScriptMetadata(next, path.parse(filename).name) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-to-disk', async (_e, filename) => {
    try {
      const code = await fs.readFile(path.join(localScriptsDir, path.basename(filename)), 'utf8');
      const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.basename(filename) });
      if (canceled || !filePath) return { success: false, error: 'Cancelled' };
      await fs.writeFile(filePath, code, 'utf8');
      return { success: true, data: { path: filePath } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ---- Phase 3: community registry ----
  ipcMain.handle('get-repos', async () => {
    try { return { success: true, data: (await getConfig()).repositories }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('add-repo', async (_e, url) => {
    try {
      let rawUrl = String(url || '').trim();
      if (rawUrl.includes('github.com')) {
        const m = rawUrl.match(/github\.com\/([^/]+\/[^/?#]+)/);
        if (!m) return { success: false, error: 'Use https://github.com/user/repo' };
        rawUrl = `https://raw.githubusercontent.com/${m[1].replace(/\.git$/, '')}/refs/heads/main/registry.json`;
      } else if (!rawUrl.includes('raw.githubusercontent.com')) {
        return { success: false, error: 'Provide a GitHub repo URL or raw registry.json URL.' };
      }
      const config = await getConfig();
      if (!config.repositories.includes(rawUrl)) { config.repositories.push(rawUrl); await saveConfig(config); }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remove-repo', async (_e, url) => {
    if (url === DEFAULT_REPO) return { success: false, error: 'Cannot remove default repository.' };
    try {
      const config = await getConfig();
      config.repositories = config.repositories.filter((r) => r !== url);
      await saveConfig(config);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('list-community-scripts', async () => {
    try {
      const config = await getConfig();
      let all = [];
      const errors = [];
      for (const url of config.repositories) {
        let res;
        try { res = await fetchFresh(url); }
        catch (e) { errors.push({ url, reason: 'unreachable', detail: e.message }); continue; }
        if (!res.ok) { errors.push({ url, reason: 'unavailable', detail: `HTTP ${res.status}` }); continue; }
        let registry;
        try { registry = await res.json(); }
        catch (e) { errors.push({ url, reason: 'invalid-json', detail: e.message }); continue; }
        for (const s of (registry.scripts || [])) all.push({ ...s, _source: url });
      }
      return { success: true, data: all, errors };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  async function fetchCommunityCode(downloadUrl) {
    const res = await fetchFresh(downloadUrl);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return res.text();
  }

  ipcMain.handle('download-community-script', async (_e, script) => {
    // Install: save local + push to Affinity
    try {
      const code = await fetchCommunityCode(script.download_url);
      const withMeta = upsertMetadataHeader(code, { name: script.name, description: script.description, version: script.version, author: script.author });
      const filename = safeFilename(script.name || 'community-script');
      await fs.writeFile(path.join(localScriptsDir, filename), withMeta, 'utf8');
      try {
        await callTool('save_script_to_library', { title: script.name || filename, description: script.description || '', code: withMeta });
      } catch (mcpErr) {
        return { success: true, pushed: false, pushError: mcpErr.message, data: { filename } };
      }
      return { success: true, pushed: true, data: { filename } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-community-script', async (_e, script) => {
    // Save-only: local disk, no MCP push
    try {
      const code = await fetchCommunityCode(script.download_url);
      const withMeta = upsertMetadataHeader(code, { name: script.name, description: script.description, version: script.version, author: script.author });
      const filename = safeFilename(script.name || 'community-script');
      await fs.writeFile(path.join(localScriptsDir, filename), withMeta, 'utf8');
      return { success: true, data: { filename } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.on('open-url', (_e, url) => shell.openExternal(url));

  // ---- Phase 7: native context menus (renderer executes actions) ----
  ipcMain.on('show-context', (_e, kind, payload = {}) => {
    if (!win || win.isDestroyed()) return;
    const send = (action) => win.webContents.send('context-action', { action, ...payload });
    const item = (label, action, extra = {}) => ({ label, click: () => send(action), ...extra });
    let template = [];
    if (kind === 'local') {
      template = [
        item('Open', 'local-open'),
        item('Install to Affinity', 'local-install'),
        { type: 'separator' },
        item('Export to disk…', 'local-export'),
        item('Rename…', 'local-rename'),
        item('Delete local…', 'local-delete'),
        { type: 'separator' },
        item('Toggle favorite', 'local-favorite'),
        item('Copy prompt for OpenCode', 'local-prompt')
      ];
    } else if (kind === 'community') {
      template = [
        item('Install (save + push)', 'community-install'),
        item('Save local only', 'community-save')
      ];
    } else if (kind === 'mcp') {
      template = [item('Download to library', 'mcp-download')];
    } else if (kind === 'editor') {
      template = [
        item('Save', 'editor-save'),
        item('Run in Affinity', 'editor-run'),
        item('Save + Install', 'editor-install'),
        { type: 'separator' },
        item('Copy prompt for OpenCode', 'editor-prompt')
      ];
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });

  // ---- Phase 4: favorites ----
  ipcMain.handle('get-favorites', async () => {
    try { return { success: true, data: (await getConfig()).favoriteScripts }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('toggle-favorite', async (_e, stem) => {
    try {
      const key = String(stem || '').replace(/\.js$/i, '').toLowerCase();
      if (!key) return { success: false, error: 'Missing script key.' };
      const config = await getConfig();
      const i = config.favoriteScripts.indexOf(key);
      if (i >= 0) config.favoriteScripts.splice(i, 1);
      else config.favoriteScripts.push(key);
      await saveConfig(config);
      return { success: true, data: config.favoriteScripts };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ---- Phase 4: render preview ----
  ipcMain.handle('render-active-preview', async () => {
    try {
      const uuidRes = await callTool('execute_script', {
        script: "const { Document } = require('/document'); console.log(Document.current.sessionUuid);"
      });
      const uuid = getTextContent(uuidRes).trim();
      if (!uuid) return { success: false, error: 'No active document open in Affinity.' };
      const render = await callTool('render_spread', { document_session_uuid: uuid, spread_index: 0 });
      const image = getImageDataUrl(render);
      if (!image) return { success: false, error: 'Nothing was rendered (empty response).' };
      return { success: true, image };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ---- Phase 4: update check (manual, no auto-download) ----
  ipcMain.handle('get-update-repo', async () => {
    try { return { success: true, data: (await getConfig()).updateRepo }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('set-update-repo', async (_e, repo) => {
    try {
      const clean = String(repo || '').trim().replace(/\/$/, '');
      if (clean && !/^https:\/\/github\.com\/[^/]+\/[^/]+$/i.test(clean)) {
        return { success: false, error: 'Use https://github.com/owner/repo format.' };
      }
      const config = await getConfig();
      config.updateRepo = clean;
      await saveConfig(config);
      return { success: true, data: clean };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('check-updates', async () => {
    try {
      const config = await getConfig();
      if (!config.updateRepo) return { success: false, error: 'No update repo set. Add your GitHub repo below first.' };
      const m = config.updateRepo.match(/github\.com\/([^/]+\/[^/]+)/i);
      const apiUrl = `https://api.github.com/repos/${m[1]}/releases/latest`;
      const res = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });
      if (res.status === 404) return { success: true, hasUpdate: false, detail: 'No releases published yet.' };
      if (!res.ok) return { success: false, error: `GitHub responded HTTP ${res.status}` };
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      const cur = app.getVersion().split('.').map(Number);
      const lat = latest.split('.').map(Number);
      let newer = false;
      for (let i = 0; i < 3; i++) {
        if ((lat[i] || 0) > (cur[i] || 0)) { newer = true; break; }
        if ((lat[i] || 0) < (cur[i] || 0)) break;
      }
      return { success: true, hasUpdate: newer, latest, current: app.getVersion(), url: rel.html_url };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ---- Phase 5: AI Script Studio (BYO key, docs-grounded) ----
  function storageAvailable() {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  async function loadApiKey() {
    const config = await getConfig();
    if (!config.apiKeyEncrypted) return '';
    try {
      if (storageAvailable()) {
        return safeStorage.decryptString(Buffer.from(config.apiKeyEncrypted, 'base64'));
      }
      return Buffer.from(config.apiKeyEncrypted, 'base64').toString('utf8'); // fallback, obfuscated only
    } catch {
      return '';
    }
  }

  async function storeApiKey(key) {
    const config = await getConfig();
    if (!key) {
      config.apiKeyEncrypted = '';
    } else if (storageAvailable()) {
      config.apiKeyEncrypted = safeStorage.encryptString(key).toString('base64');
    } else {
      config.apiKeyEncrypted = Buffer.from(key, 'utf8').toString('base64');
    }
    await saveConfig(config);
  }

  async function buildGrounding() {
    // Static rules + truncated SDK docs from docs-cache + hello template.
    const rules = [
      'You write Affinity V3 JavaScript automation scripts (Affinity 3.2+, in-app JS runtime).',
      'Output ONE plain .js script. Start with a metadata header block: /** with lowercase tags name:, description:, version:, author: (/** must be the first line).',
      "Use the documented runtime only, e.g. const { app } = require('/application'); app.alert('Hi');",
      'Scripts do NOT return values. Use console.log() for output; end with console.log(\'Done …\').',
      'Prefer SDK modules /application and /document. NEVER invent APIs — if the SDK reference below lacks an API, say so and stub it with a clearly marked TODO comment.',
      'Keep scripts short and robust: wrap main work in try/catch that console.log()s the error.',
      'Reply with a 1-2 sentence explanation, then the full script in a single ```js fenced block.'
    ].join('\n');
    let docs = '';
    try {
      const files = (await fs.readdir(docsCacheDir)).filter((f) => f.endsWith('.md')).sort().slice(0, 40);
      const chunks = [];
      let total = 0;
      for (const f of files) {
        try {
          const text = (await fs.readFile(path.join(docsCacheDir, f), 'utf8')).slice(0, 1500);
          if (total + text.length > 12000) break;
          total += text.length;
          chunks.push(`--- ${f} ---\n${text}`);
        } catch {}
      }
      docs = chunks.join('\n\n');
    } catch {}
    let template = '';
    try { template = (await fs.readFile(path.join(__dirname, 'templates', 'hello.js'), 'utf8')).slice(0, 800); } catch {}
    return { rules, docs, template };
  }

  function extractCode(text) {
    const m = String(text || '').match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/i);
    if (m) return m[1].trim();
    return String(text || '').trim();
  }

  async function callAnthropic({ apiKey, model, system, userText }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: userText }] })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 300) || res.statusText}`);
      }
      const data = await res.json();
      return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    } finally {
      clearTimeout(timer);
    }
  }

  async function callOpenAICompatible({ apiKey, baseUrl, model, system, userText }) {
    const base = String(baseUrl || '').replace(/\/$/, '');
    if (!base) throw new Error('Set a custom base URL for the OpenAI-compatible provider (e.g. https://api.openai.com/v1).');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Provider HTTP ${res.status}: ${body.slice(0, 300) || res.statusText}`);
      }
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!text) throw new Error('Provider returned no content.');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async function runStudio({ mode, task, code, error, bufferCode, filename }) {
    const config = await getConfig();
    const apiKey = await loadApiKey();
    if (!apiKey) throw new Error('No API key saved. Add your key in the Studio tab first.');
    const { rules, docs, template } = await buildGrounding();
    const system = `${rules}\n\nSDK REFERENCE (truncated, from this Affinity install — refresh via Docs tab):\n${docs || '(empty — user has not refreshed SDK docs yet; stick to the minimal runtime pattern)'}\n\nSTYLE TEMPLATE:\n${template}`;
    let userText;
    if (mode === 'fix') {
      userText = `This Affinity script failed when run in Affinity. Fix it and return the FULL corrected script.\n\nFilename: ${filename || 'untitled.js'}\n\nBROKEN SCRIPT:\n\`\`\`js\n${code}\n\`\`\`\n\nAFFINITY ERROR OUTPUT:\n${error}\n\nRules: keep the same metadata header (fix name/description if wrong), change as little as possible, only use SDK APIs present in the reference above.`;
    } else {
      userText = `Task: ${task}\n\nTarget filename: ${filename || 'untitled.js'}` +
        (bufferCode ? `\n\nCurrent editor buffer (use as context, improve or extend it):\n\`\`\`js\n${bufferCode.slice(0, 6000)}\n\`\`\`` : '\n\nWrite a fresh script.');
    }
    const raw = config.aiProvider === 'openai'
      ? await callOpenAICompatible({ apiKey, baseUrl: config.aiBaseUrl, model: config.aiModel, system, userText })
      : await callAnthropic({ apiKey, model: config.aiModel, system, userText });
    const script = extractCode(raw);
    const explanation = raw.replace(/```[\s\S]*?```/g, '').trim().split('\n').filter(Boolean).slice(0, 4).join(' ');
    return { raw, code: script, explanation };
  }

  ipcMain.handle('ai-status', async () => {
    try {
      const config = await getConfig();
      const key = await loadApiKey();
      return { success: true, hasKey: Boolean(key), provider: config.aiProvider, model: config.aiModel, baseUrl: config.aiBaseUrl, secure: storageAvailable() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ai-save-settings', async (_e, settings) => {
    try {
      const config = await getConfig();
      if (settings.provider === 'openai' || settings.provider === 'anthropic') config.aiProvider = settings.provider;
      if (typeof settings.model === 'string' && settings.model.trim()) config.aiModel = settings.model.trim();
      if (typeof settings.baseUrl === 'string') config.aiBaseUrl = settings.baseUrl.trim().replace(/\/$/, '');
      await saveConfig(config);
      if (typeof settings.apiKey === 'string' && settings.apiKey.trim()) await storeApiKey(settings.apiKey.trim());
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ai-clear-key', async () => {
    try { await storeApiKey(''); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('ai-generate', async (_e, payload) => {
    try {
      if (!payload || !String(payload.task || '').trim()) return { success: false, error: 'Describe the task first.' };
      const result = await runStudio({ mode: 'generate', task: payload.task.trim(), bufferCode: payload.useBuffer ? payload.bufferCode : '', filename: payload.filename });
      return { success: true, data: result };
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Request timed out after 120s. Try a shorter task.' : e.message;
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('ai-fix', async (_e, payload) => {
    try {
      if (!payload || !payload.code) return { success: false, error: 'Nothing to fix.' };
      const result = await runStudio({ mode: 'fix', code: payload.code, error: payload.error || '(no error text)', filename: payload.filename });
      return { success: true, data: result };
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Request timed out after 120s. Try again.' : e.message;
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('get-ui-prefs', async () => {
    try {
      const config = await getConfig();
      return { success: true, data: { previewOnRun: config.previewOnRun !== false, previewZoom: config.previewZoom || 'fit' } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('set-ui-prefs', async (_e, prefs) => {
    try {
      const config = await getConfig();
      if (prefs && typeof prefs.previewOnRun === 'boolean') config.previewOnRun = prefs.previewOnRun;
      if (prefs && ['fit', 'full'].includes(prefs.previewZoom)) config.previewZoom = prefs.previewZoom;
      await saveConfig(config);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    try { await affinity.close(); } catch {}
    app.quit();
  }
});
