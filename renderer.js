const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const localList = $('local-list');
const mcpList = $('mcp-list');
const filenameInput = $('filename');
const output = $('output');
const runTime = $('run-time');
const watchToggle = $('watch-toggle');
const docsOutput = $('docs-output');
const docsList = $('docs-list');
const docsSearch = $('docs-search');
const repoUrl = $('repo-url');
const repoList = $('repo-list');
const communityList = $('community-list');
const localSearch = $('local-search');
const communitySearch = $('community-search');
const previewImg = $('preview');
const updateRepoInput = $('update-repo');
const updateStatus = $('update-status');
const dropOverlay = $('drop-overlay');
const tabDocs = $('tab-docs');
const tabStudio = $('tab-studio');
const paneDocs = $('pane-docs');
const paneStudio = $('pane-studio');
const aiStatusLine = $('ai-status-line');
const studioLog = $('studio-log');
const studioTask = $('studio-task');
const studioUseBuffer = $('studio-use-buffer');
const studioProvider = $('studio-provider');
const studioModel = $('studio-model');
const studioBase = $('studio-base');
const studioBaseWrap = $('studio-base-wrap');
const studioKey = $('studio-key');

const HELLO_TEMPLATE = `/**\n * name: Hello World\n * description: Minimal Affinity V3 script.\n * version: 0.1.0\n * author: Scriptify\n */\n\nconst { app } = require('/application');\napp.alert('Hello, World!');\nconsole.log('Hello from Scriptify');\n`;

// ---- caches ----
let localCache = [];
let communityCache = [];
let favorites = new Set();

// ---- editor: Ace with textarea fallback ----
let aceEditor = null;
function getCode() {
  if (aceEditor) return aceEditor.getValue();
  return $('editor-fallback').value;
}
function setCode(code) {
  if (aceEditor) aceEditor.setValue(code, -1);
  else $('editor-fallback').value = code;
}
function initEditor() {
  try {
    if (window.ace && $('ace-editor')) {
      aceEditor = window.ace.edit('ace-editor');
      aceEditor.setTheme('ace/theme/github');
      aceEditor.session.setMode('ace/mode/javascript');
      aceEditor.setOptions({ fontSize: 13, showPrintMargin: false, wrap: true });
      aceEditor.setValue(HELLO_TEMPLATE, -1);
      $('editor-fallback').style.display = 'none';
    } else {
      throw new Error('ace missing');
    }
  } catch {
    const fb = $('editor-fallback');
    fb.style.display = 'block';
    fb.value = HELLO_TEMPLATE;
    const aceDiv = $('ace-editor');
    if (aceDiv) aceDiv.style.display = 'none';
  }
  if (window.ace && aceEditor) {
    aceEditor.commands.addCommand({
      name: 'save', bindKey: { win: 'Ctrl-S', mac: 'Command-S' },
      exec: () => $('btn-save').click()
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stemOf(file) {
  return String(file || '').replace(/\.js$/i, '').toLowerCase();
}

// ---- library ----
async function refreshStatus() {
  try {
    const r = await window.scriptify.mcpStatus();
    statusEl.textContent = r.connected ? `MCP: connected (${r.url})` : `MCP: offline — ${r.error || 'start Affinity + enable connector'}`;
    statusEl.className = 'status ' + (r.connected ? 'online' : 'offline');
  } catch (e) {
    statusEl.textContent = 'MCP: bridge error — ' + e.message;
    statusEl.className = 'status offline';
  }
}

async function loadFavorites() {
  try {
    const r = await window.scriptify.getFavorites();
    if (r.success) favorites = new Set(r.data);
  } catch {}
}

function renderLocal() {
  const q = (localSearch.value || '').trim().toLowerCase();
  const items = localCache
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.file.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
    .sort((a, b) => {
      const fa = favorites.has(stemOf(a.file)) ? 0 : 1;
      const fb = favorites.has(stemOf(b.file)) ? 0 : 1;
      return fa - fb || a.name.localeCompare(b.name);
    });
  localList.innerHTML = '';
  if (!items.length) { localList.innerHTML = '<li>(no matches)</li>'; return; }
  for (const s of items) {
    const li = document.createElement('li');
    li.className = 'script-row';
    const star = document.createElement('button');
    star.className = 'mini star' + (favorites.has(stemOf(s.file)) ? ' on' : '');
    star.textContent = favorites.has(stemOf(s.file)) ? '★' : '☆';
    star.title = 'Favorite';
    star.onclick = async (e) => {
      e.stopPropagation();
      const r = await window.scriptify.toggleFavorite(s.file);
      if (r.success) { favorites = new Set(r.data); renderLocal(); renderCommunity(); }
    };
    const label = document.createElement('span');
    label.className = 'script-label';
    label.innerHTML = `<b></b> <span class="muted"></span>`;
    label.querySelector('b').textContent = s.name;
    label.querySelector('.muted').textContent = s.file;
    label.title = (s.description || '') + ' — click to open';
    label.onclick = async () => {
      const res = await window.scriptify.readLocal(s.file);
      if (res.success) { setCode(res.data.code); filenameInput.value = s.file; output.textContent = `Loaded ${s.file}`; }
      else output.textContent = `Open failed: ${res.error}`;
    };
    const actions = document.createElement('span');
    actions.className = 'mini-actions';
    const mkBtn = (t, title, fn) => {
      const b = document.createElement('button');
      b.textContent = t; b.title = title; b.className = 'mini';
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    actions.appendChild(mkBtn('⤓', 'Export to disk', async () => {
      const res = await window.scriptify.exportToDisk(s.file);
      output.textContent = res.success ? `Exported to ${res.data.path}` : `Export: ${res.error}`;
    }));
    actions.appendChild(mkBtn('✎', 'Rename', async () => {
      const next = prompt(`Rename ${s.file} → (without .js)`, s.file.replace(/\.js$/i, ''));
      if (!next) return;
      const res = await window.scriptify.renameLocal(s.file, next);
      output.textContent = res.success ? `Renamed to ${res.data.filename}` : `Rename failed: ${res.error}`;
      if (res.success) { filenameInput.value = res.data.filename; refreshLists(); }
    }));
    actions.appendChild(mkBtn('🗑', 'Delete local (Affinity copy stays)', async () => {
      if (!confirm(`Delete local ${s.file}? Affinity library copy stays — remove it in Affinity panel.`)) return;
      const res = await window.scriptify.deleteLocal(s.file);
      output.textContent = res.success ? `Deleted local ${s.file}.` : `Delete failed: ${res.error}`;
      if (res.success) refreshLists();
    }));
    li.appendChild(star);
    li.appendChild(label);
    li.appendChild(actions);
    localList.appendChild(li);
  }
}

async function refreshLists() {
  localList.innerHTML = '<li>loading…</li>';
  mcpList.innerHTML = '<li>loading…</li>';
  await loadFavorites();
  try {
    const r = await window.scriptify.listLocal();
    if (!r.success) localList.innerHTML = `<li class="err">${escapeHtml(r.error)}</li>`;
    else { localCache = r.data || []; renderLocal(); }
  } catch (e) { localList.innerHTML = `<li class="err">${escapeHtml(e.message)}</li>`; }

  try {
    const r = await window.scriptify.listMcp();
    mcpList.innerHTML = '';
    if (!r.success) mcpList.innerHTML = `<li class="err">${escapeHtml(r.error)}</li>`;
    else if (!r.data.length) mcpList.innerHTML = '<li>(nothing in Affinity library)</li>';
    for (const title of (r.data || [])) {
      const li = document.createElement('li');
      li.textContent = title;
      li.onclick = async () => {
        const res = await window.scriptify.downloadFromMcp(title);
        output.textContent = res.success ? `Downloaded "${title}" to local library. Refreshing…` : `Download failed: ${res.error}`;
        if (res.success) refreshLists();
      };
      li.title = 'Click to download to local library';
      mcpList.appendChild(li);
    }
  } catch (e) { mcpList.innerHTML = `<li class="err">${escapeHtml(e.message)}</li>`; }
}

// ---- community ----
async function refreshRepos() {
  const r = await window.scriptify.getRepos();
  repoList.innerHTML = '';
  if (!r.success) { repoList.innerHTML = `<li class="err">${escapeHtml(r.error)}</li>`; return; }
  for (const url of r.data) {
    const li = document.createElement('li');
    li.className = 'script-row';
    const span = document.createElement('span');
    span.className = 'repo-url';
    span.textContent = url.replace('https://raw.githubusercontent.com/', '').replace('/refs/heads/main/registry.json', '');
    span.title = url;
    li.appendChild(span);
    if (!url.includes('JiriKrblich/Affinity-Community-Scripts')) {
      const b = document.createElement('button');
      b.textContent = '✕'; b.className = 'mini'; b.title = 'Remove repo';
      b.onclick = async () => {
        const res = await window.scriptify.removeRepo(url);
        output.textContent = res.success ? 'Repo removed.' : `Remove failed: ${res.error}`;
        refreshRepos();
      };
      li.appendChild(b);
    }
    repoList.appendChild(li);
  }
}

function communityKey(s) {
  return String(s.name || s.id || '').toLowerCase();
}

function renderCommunity() {
  const q = (communitySearch.value || '').trim().toLowerCase();
  const items = communityCache
    .filter((s) => !q || (s.name || '').toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q) || (s.category || '').toLowerCase().includes(q))
    .sort((a, b) => {
      const fa = favorites.has(communityKey(a)) ? 0 : 1;
      const fb = favorites.has(communityKey(b)) ? 0 : 1;
      return fa - fb || String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, 100);
  communityList.innerHTML = '';
  if (!items.length) { communityList.innerHTML = '<li>(no matches)</li>'; return; }
  for (const s of items) {
    const li = document.createElement('li');
    li.className = 'script-row';
    const star = document.createElement('button');
    star.className = 'mini star' + (favorites.has(communityKey(s)) ? ' on' : '');
    star.textContent = favorites.has(communityKey(s)) ? '★' : '☆';
    star.title = 'Favorite';
    star.onclick = async (e) => {
      e.stopPropagation();
      const r = await window.scriptify.toggleFavorite(s.name || s.id);
      if (r.success) { favorites = new Set(r.data); renderLocal(); renderCommunity(); }
    };
    const label = document.createElement('span');
    label.innerHTML = `<b></b> <span class="muted"></span>`;
    label.querySelector('b').textContent = s.name || s.id;
    label.querySelector('.muted').textContent = [s.category, s.version ? `v${s.version}` : ''].filter(Boolean).join(' ');
    label.title = s.description || '';
    li.appendChild(star);
    li.appendChild(label);
    const actions = document.createElement('span');
    actions.className = 'mini-actions';
    const installBtn = document.createElement('button');
    installBtn.textContent = 'Install'; installBtn.className = 'mini primary'; installBtn.title = 'Save local + push to Affinity';
    installBtn.onclick = async () => {
      output.textContent = `Installing "${s.name}"…`;
      const res = await window.scriptify.installCommunity(s);
      output.textContent = res.success
        ? (res.pushed ? `Installed "${s.name}" → ${res.data.filename} + Affinity.` : `Saved "${s.name}" locally (${res.data.filename}); Affinity push failed: ${res.pushError}`)
        : `Install failed: ${res.error}`;
      if (res.success) refreshLists();
    };
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save'; saveBtn.className = 'mini'; saveBtn.title = 'Save local only';
    saveBtn.onclick = async () => {
      const res = await window.scriptify.saveCommunity(s);
      output.textContent = res.success ? `Saved "${s.name}" → ${res.data.filename} (not installed).` : `Save failed: ${res.error}`;
      if (res.success) refreshLists();
    };
    actions.appendChild(installBtn);
    actions.appendChild(saveBtn);
    li.appendChild(actions);
    communityList.appendChild(li);
  }
}

async function refreshCommunity() {
  communityList.innerHTML = '<li>loading community…</li>';
  const r = await window.scriptify.listCommunity();
  communityList.innerHTML = '';
  if (!r.success) { communityList.innerHTML = `<li class="err">${escapeHtml(r.error)}</li>`; return; }
  if ((r.errors || []).length) {
    const li = document.createElement('li');
    li.className = 'err';
    li.textContent = `${r.errors.length} repo(s) unreachable — see Output.`;
    communityList.appendChild(li);
    output.textContent = 'Community repo issues:\n' + r.errors.map((e) => `${e.url}: ${e.reason} ${e.detail || ''}`).join('\n');
  }
  communityCache = r.data || [];
  if (!communityCache.length && !(r.errors || []).length) { communityList.innerHTML = '<li>(no community scripts)</li>'; return; }
  renderCommunity();
}

// ---- docs ----
async function refreshDocs() {
  docsOutput.textContent = 'Fetching SDK docs from Affinity… (preamble-primed)';
  const r = await window.scriptify.fetchDocs();
  if (!r.success) { docsOutput.textContent = 'Docs fetch failed: ' + r.error; return; }
  docsOutput.textContent = `Loaded ${r.data.length} topics. Cached to docs-cache/.`;
  docsList.innerHTML = '';
  for (const d of r.data) {
    const li = document.createElement('li');
    li.textContent = d.title;
    li.title = 'Click to view';
    li.onclick = () => { docsOutput.textContent = `# ${d.title}\n\n${d.content}`; };
    docsList.appendChild(li);
  }
}

async function searchHints() {
  const q = docsSearch.value.trim();
  if (!q) { docsOutput.textContent = 'Type a query first (e.g. "blend mode").'; return; }
  docsOutput.textContent = 'Searching SDK hints…';
  const r = await window.scriptify.searchDocs(q);
  docsOutput.textContent = r.success ? r.data : 'Search failed: ' + r.error;
}

function copyPrompt() {
  const code = getCode();
  const prompt = `You are helping with an Affinity V3 JS script (Affinity 3.2+, MCP at http://localhost:6767/sse).\nRules: plain .js only, metadata header with lowercase name:/description:, use require('/application'), console.log for output, no invented APIs.\nCurrent script (${filenameInput.value || 'untitled.js'}):\n\`\`\`js\n${code}\n\`\`\`\nTask: `;
  navigator.clipboard.writeText(prompt).then(
    () => { output.textContent = 'Prompt + current buffer copied. Paste into OpenCode.'; },
    (e) => { output.textContent = 'Copy failed: ' + e.message; }
  );
}

// ---- updates ----
async function loadUpdateRepo() {
  try {
    const r = await window.scriptify.getUpdateRepo();
    if (r.success) updateRepoInput.value = r.data || '';
  } catch {}
}

// ---- drag & drop import ----
function initDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    depth++;
    dropOverlay.style.display = 'flex';
    e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropOverlay.style.display = 'none';
    e.preventDefault();
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    dropOverlay.style.display = 'none';
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.name.endsWith('.js'));
    if (!files.length) { output.textContent = 'Drop .js files to import.'; return; }
    for (const f of files) {
      const code = await f.text();
      const save = await window.scriptify.saveLocal(f.name, code);
      if (!save.success) { output.textContent = `Import ${f.name} failed: ${save.error}`; continue; }
      const install = confirm(`Imported ${f.name}.\nOK = Save + Install to Affinity\nCancel = Save local only`);
      if (install) {
        const p = await window.scriptify.pushToMcp(f.name);
        output.textContent = p.success ? `Imported + installed ${f.name}.` : `Saved ${f.name}; install failed: ${p.error}`;
      } else {
        output.textContent = `Imported ${f.name} (local only).`;
      }
    }
    refreshLists();
  });
}

// ---- AI Script Studio ----
const FIX_LIMIT = 3;

function studioMsg(kind, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  div.innerHTML = html;
  studioLog.appendChild(div);
  studioLog.scrollTop = studioLog.scrollHeight;
  return div;
}

function studioMsgText(kind, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  div.textContent = text;
  studioLog.appendChild(div);
  studioLog.scrollTop = studioLog.scrollHeight;
  return div;
}

async function refreshAiStatus() {
  try {
    const r = await window.scriptify.aiStatus();
    if (!r.success) { aiStatusLine.textContent = 'AI status error: ' + r.error; return; }
    studioProvider.value = r.provider || 'anthropic';
    if (r.model) studioModel.value = r.model;
    if (r.baseUrl) studioBase.value = r.baseUrl;
    studioBaseWrap.style.display = studioProvider.value === 'openai' ? 'block' : 'none';
    aiStatusLine.textContent = r.hasKey
      ? `Ready — ${r.provider === 'openai' ? 'OpenAI-compatible' : 'Claude'} ${r.model}${r.secure ? ' · key encrypted' : ' · OS keychain unavailable, key obfuscated only'}.`
      : 'AI not configured — add a key below to enable generation.';
  } catch (e) {
    aiStatusLine.textContent = 'AI status error: ' + e.message;
  }
}

function showTabs(which) {
  const docs = which === 'docs';
  tabDocs.classList.toggle('active', docs);
  tabStudio.classList.toggle('active', !docs);
  paneDocs.style.display = docs ? 'block' : 'none';
  paneStudio.style.display = docs ? 'none' : 'block';
}

function addAiResultActions(box, code) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const mk = (label, primary, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (!primary) b.className = 'ghost';
    b.onclick = fn;
    actions.appendChild(b);
  };
  mk('Insert into editor', true, () => {
    setCode(code);
    const m = code.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (m) {
      const nm = m[1].match(/name:\s*(.*)/i);
      if (nm) filenameInput.value = nm[1].trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') + '.js';
    }
    output.textContent = 'Studio script loaded in editor. Review, then Run or Install.';
  });
  mk('Run', false, async () => {
    output.textContent = 'Running Studio script…';
    const r = await window.scriptify.execute(code);
    output.textContent = r.success ? (r.output || '(no output — ran clean)') : `Run failed: ${r.error}`;
  });
  mk('Run + auto-fix', false, () => autoFixLoop(code, 1));
  box.appendChild(actions);
}

async function autoFixLoop(code, attempt) {
  output.textContent = `Studio run (attempt ${attempt})…`;
  const r = await window.scriptify.execute(code);
  if (r.success) {
    output.textContent = (r.output || '(no output — ran clean)') + (attempt > 1 ? `\n\nFixed after ${attempt} attempts.` : '');
    return;
  }
  if (attempt >= FIX_LIMIT) {
    output.textContent = `Still failing after ${FIX_LIMIT} attempts: ${r.error}\nLast error kept in editor for manual fix.`;
    setCode(code);
    return;
  }
  output.textContent = `Attempt ${attempt} failed — asking AI to fix…`;
  const f = await window.scriptify.aiFix({ code, error: r.error, filename: filenameInput.value || 'untitled.js' });
  if (!f.success) {
    output.textContent = `Auto-fix failed: ${f.error}\nOriginal error: ${r.error}`;
    setCode(code);
    return;
  }
  studioMsgText('ai', f.data.explanation ? `Fix attempt ${attempt}: ${f.data.explanation}` : `Fix attempt ${attempt} ready — re-running…`);
  await autoFixLoop(f.data.code, attempt + 1);
  if (attempt === 1) setCode(f.data.code);
}

async function studioGenerate() {
  const task = studioTask.value.trim();
  if (!task) { studioMsgText('ai', 'Describe the script first — e.g. "rename all layers with their blend mode".'); return; }
  studioMsgText('user', task);
  studioTask.value = '';
  const thinking = studioMsg('ai', '<span class="thinking">Generating, grounded in your SDK docs…</span>');
  const r = await window.scriptify.aiGenerate({
    task,
    useBuffer: studioUseBuffer.checked,
    bufferCode: getCode(),
    filename: filenameInput.value || 'untitled.js'
  });
  thinking.remove();
  if (!r.success) { studioMsgText('ai', 'Generation failed: ' + r.error); return; }
  const box = studioMsgText('ai', r.data.explanation || 'Script ready.');
  addAiResultActions(box, r.data.code);
}

// ---- wire up ----
$('btn-refresh').onclick = async () => { await refreshStatus(); await refreshLists(); await refreshRepos(); };
$('btn-new').onclick = () => { setCode(HELLO_TEMPLATE); filenameInput.value = 'hello-world.js'; output.textContent = 'Template loaded. Edit, Save, then Run.'; };

$('btn-save').onclick = async () => {
  const fn = (filenameInput.value || 'untitled.js').trim();
  const r = await window.scriptify.saveLocal(fn, getCode());
  output.textContent = r.success ? `Saved ${fn} locally.` : `Save failed: ${r.error}`;
  if (r.success) refreshLists();
};

$('btn-run').onclick = async () => {
  output.textContent = 'Running in Affinity…';
  $('drawer').classList.remove('closed');
  $('drawer-chev').textContent = '▾';
  previewImg.style.display = 'none';
  const t0 = Date.now();
  const r = await window.scriptify.execute(getCode());
  runTime.textContent = `(${(Date.now() - t0) / 1000}s)`;
  output.textContent = r.success ? (r.output || '(no output — script ran, nothing logged)') : `Run failed: ${r.error}`;
};

$('btn-install').onclick = async () => {
  const fn = (filenameInput.value || 'untitled.js').trim();
  const s = await window.scriptify.saveLocal(fn, getCode());
  if (!s.success) { output.textContent = `Save failed: ${s.error}`; return; }
  const p = await window.scriptify.pushToMcp(fn);
  output.textContent = p.success ? `Installed ${fn} to Affinity library.` : `Saved locally, install failed: ${p.error}`;
  refreshLists();
};

$('btn-preview').onclick = async () => {
  output.textContent = 'Rendering active document…';
  const r = await window.scriptify.renderPreview();
  if (r.success) {
    previewImg.src = r.image;
    previewImg.style.display = 'block';
    output.textContent = 'Preview rendered below Output.';
  } else {
    output.textContent = `Preview failed: ${r.error} (needs an open document + render_spread support)`;
  }
};

$('btn-docs').onclick = refreshDocs;
$('btn-search').onclick = searchHints;
docsSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchHints(); });
tabDocs.onclick = () => showTabs('docs');
tabStudio.onclick = () => { showTabs('studio'); refreshAiStatus(); };
$('btn-drawer').onclick = () => {
  const d = $('drawer');
  d.classList.toggle('closed');
  $('drawer-chev').textContent = d.classList.contains('closed') ? '▸' : '▾';
};
$('btn-studio-generate').onclick = studioGenerate;
studioTask.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); studioGenerate(); }
});
studioProvider.onchange = () => {
  studioBaseWrap.style.display = studioProvider.value === 'openai' ? 'block' : 'none';
  if (studioProvider.value === 'openai' && !studioModel.value.startsWith('claude')) studioModel.value = 'gpt-4o';
  if (studioProvider.value === 'anthropic' && !studioModel.value.startsWith('gpt')) studioModel.value = 'claude-sonnet-4-5';
};
$('btn-studio-save').onclick = async () => {
  const r = await window.scriptify.aiSaveSettings({
    provider: studioProvider.value,
    model: studioModel.value.trim(),
    baseUrl: studioBase.value.trim(),
    apiKey: studioKey.value
  });
  if (r.success) { studioKey.value = ''; output.textContent = 'Studio settings saved.'; refreshAiStatus(); }
  else output.textContent = 'Save failed: ' + r.error;
};
$('btn-studio-clear').onclick = async () => {
  const r = await window.scriptify.aiClearKey();
  output.textContent = r.success ? 'API key cleared.' : 'Clear failed: ' + r.error;
  refreshAiStatus();
};
$('btn-copy-prompt').onclick = copyPrompt;
$('btn-add-repo').onclick = async () => {
  const url = repoUrl.value.trim();
  if (!url) { output.textContent = 'Paste a GitHub repo URL first.'; return; }
  const r = await window.scriptify.addRepo(url);
  output.textContent = r.success ? 'Repo added. Loading…' : `Add failed: ${r.error}`;
  if (r.success) { repoUrl.value = ''; await refreshRepos(); await refreshCommunity(); }
};
$('btn-community').onclick = async () => { await refreshRepos(); await refreshCommunity(); };

localSearch.addEventListener('input', renderLocal);
localSearch.addEventListener('keydown', (e) => { if (e.key === 'Escape') { localSearch.value = ''; renderLocal(); } });
communitySearch.addEventListener('input', renderCommunity);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); localSearch.focus(); }
});

$('btn-update-repo').onclick = async () => {
  const r = await window.scriptify.setUpdateRepo(updateRepoInput.value.trim());
  updateStatus.textContent = r.success ? (r.data ? `Update repo set: ${r.data}` : 'Update repo cleared.') : `Error: ${r.error}`;
};
$('btn-check-updates').onclick = async () => {
  updateStatus.textContent = 'Checking GitHub releases…';
  const r = await window.scriptify.checkUpdates();
  if (!r.success) { updateStatus.textContent = `Check failed: ${r.error}`; return; }
  if (r.hasUpdate) {
    updateStatus.innerHTML = '';
    updateStatus.textContent = `Update available: v${r.current} → v${r.latest}. `;
    const a = document.createElement('a');
    a.href = '#'; a.textContent = 'Open release page';
    a.onclick = (e) => { e.preventDefault(); window.scriptify.openUrl(r.url); };
    updateStatus.appendChild(a);
  } else {
    updateStatus.textContent = r.detail || `Up to date (v${r.current || 'dev'}).`;
  }
};

watchToggle.onchange = async () => {
  const r = await window.scriptify.setWatch(watchToggle.checked);
  output.textContent = r.success ? `Watch Mode ${r.enabled ? 'ON — saving an installed script auto-repushes it' : 'OFF'}.` : 'Watch toggle failed.';
};
window.scriptify.onWatchPush((d) => {
  output.textContent = d.success ? `[watch] re-pushed ${d.file} → "${d.title}"` : `[watch] re-push failed for ${d.file}: ${d.error}`;
});
// External library changes (agent/CLI saves via the MCP server) → debounced refresh.
let libChangedTimer = null;
window.scriptify.onLibraryChanged(() => {
  if (libChangedTimer) clearTimeout(libChangedTimer);
  libChangedTimer = setTimeout(() => refreshLists(), 600);
});
window.scriptify.getWatch().then((r) => { if (r.success) watchToggle.checked = r.enabled; }).catch(() => {});

initEditor();
initDrop();
refreshStatus();
refreshLists();
refreshRepos();
loadUpdateRepo();
