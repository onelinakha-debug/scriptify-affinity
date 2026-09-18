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
let mcpTitles = [];
let selectedFile = '';

// ---- property panel ----
function setSelected(file) {
  selectedFile = file;
  renderPropCard();
}

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  return (b / 1024).toFixed(1) + ' KB';
}

function renderPropCard() {
  const card = $('prop-card');
  const entry = localCache.find((s) => s.file === selectedFile);
  if (!entry) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  $('prop-name').textContent = entry.name;
  $('prop-desc').textContent = entry.description || 'No description.';
  $('prop-ver').textContent = (entry.version ? 'v' + entry.version : 'unversioned') + ' · ' + fmtSize(entry.size);
  $('prop-size').textContent = new Date(entry.modified).toLocaleDateString();
  const installed = mcpTitles.map((t) => t.toLowerCase()).includes(entry.name.toLowerCase());
  const badge = $('prop-installed');
  badge.textContent = installed ? '● Installed' : '○ Local only';
  badge.className = 'status ' + (installed ? 'online' : 'offline');
  $('prop-in-name').value = entry.name;
  $('prop-in-desc').value = entry.description || '';
  $('prop-in-ver').value = entry.version || '';
}

function bumpPatch(v) {
  const parts = String(v || '0.1.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2]++;
  return parts.join('.');
}

// ---- editor: Ace with per-buffer sessions + textarea fallback ----
const MAX_TABS = 8;
let aceEditor = null;
let buffers = [];
let activeIdx = -1;
let suppressDirty = false;

function activeBuffer() { return buffers[activeIdx] || null; }

function getCode() {
  if (aceEditor) return aceEditor.getValue();
  return $('editor-fallback').value;
}

function setCode(code) {
  const b = activeBuffer();
  suppressDirty = true;
  if (aceEditor && b && b.session) { b.session.setValue(code); b.code = code; }
  else { $('editor-fallback').value = code; if (b) b.code = code; }
  suppressDirty = false;
  if (b) b.dirty = true; // programmatic inserts (Studio, fixes) dirty the tab
  renderBufferTabs();
}

function openBuffer(file, code) {
  const existing = buffers.findIndex((b) => b.file === file);
  if (existing >= 0) {
    // Refresh clean tabs with fresh code (e.g. re-opened after external change).
    if (code !== undefined && !buffers[existing].dirty && buffers[existing].code !== code) {
      suppressDirty = true;
      if (aceEditor && buffers[existing].session) buffers[existing].session.setValue(code);
      suppressDirty = false;
      buffers[existing].code = code;
    }
    activateBuffer(existing);
    return;
  }
  if (buffers.length >= MAX_TABS) {
    const cleanIdx = buffers.findIndex((b) => !b.dirty);
    const evict = cleanIdx >= 0 ? cleanIdx : 0;
    if (buffers[evict].dirty && !confirm(`Close ${buffers[evict].file} without saving? (8-tab limit)`)) return;
    const evictedActive = evict === activeIdx;
    buffers.splice(evict, 1);
    // Never persist the evicted session into a neighbor — drop the pointer first.
    if (evictedActive) activeIdx = -1;
    else if (activeIdx > evict) activeIdx--;
  }
  let session = null;
  if (aceEditor) {
    session = window.ace.createEditSession(code || '', 'ace/mode/javascript');
    session.on('change', () => {
      if (suppressDirty) return;
      const b = buffers.find((x) => x.session === session);
      if (b && !b.dirty) { b.dirty = true; renderBufferTabs(); }
    });
  }
  buffers.push({ file, code: code || '', session, dirty: false });
  activateBuffer(buffers.length - 1);
}

function activateBuffer(i) {
  const cur = activeBuffer();
  if (cur) cur.code = getCode();
  activeIdx = i;
  const b = activeBuffer();
  if (!b) return;
  suppressDirty = true;
  if (aceEditor && b.session) aceEditor.setSession(b.session);
  else $('editor-fallback').value = b.code;
  suppressDirty = false;
  filenameInput.value = b.file;
  setSelected(b.file);
  renderBufferTabs();
}

function closeBuffer(i) {
  const b = buffers[i];
  if (!b) return;
  if (b.dirty && !confirm(`Close ${b.file} without saving?`)) return;
  const wasActive = i === activeIdx;
  buffers.splice(i, 1);
  if (!buffers.length) { activeIdx = -1; openBuffer('untitled.js', HELLO_TEMPLATE); return; }
  if (wasActive) { activeIdx = -1; activateBuffer(Math.min(i, buffers.length - 1)); }
  else { if (activeIdx > i) activeIdx--; renderBufferTabs(); }
}

function markActiveClean() {
  const b = activeBuffer();
  if (b) b.dirty = false;
  renderBufferTabs();
}

function syncBuffersAfterRename(oldFile, newFile) {
  let changed = false;
  for (const b of buffers) if (b.file === oldFile) { b.file = newFile; changed = true; }
  if (!changed) return;
  const b = activeBuffer();
  if (b) filenameInput.value = b.file;
  if (selectedFile === oldFile) setSelected(newFile);
  renderBufferTabs();
}

function dropBuffersForDeleted(file) {
  // Dirty tabs stay open (content preserved; saving recreates the file).
  const keep = buffers.filter((b) => b.file !== file || b.dirty);
  if (keep.length === buffers.length) return;
  const activeFile = activeBuffer() && activeBuffer().file;
  buffers = keep;
  if (!buffers.length) { activeIdx = -1; openBuffer('untitled.js', HELLO_TEMPLATE); return; }
  const idx = buffers.findIndex((b) => b.file === activeFile);
  activeIdx = -1;
  activateBuffer(idx >= 0 ? idx : 0);
}

function renderBufferTabs() {
  const strip = $('buffer-tabs');
  if (!strip) return;
  strip.innerHTML = '';
  buffers.forEach((b, i) => {
    const t = document.createElement('button');
    t.className = 'buf-tab' + (i === activeIdx ? ' active' : '') + (b.dirty ? ' dirty' : '');
    const label = document.createElement('span');
    label.textContent = (b.dirty ? '● ' : '') + b.file;
    const x = document.createElement('span');
    x.className = 'buf-x';
    x.textContent = '✕';
    x.title = 'Close';
    x.onclick = (e) => { e.stopPropagation(); closeBuffer(i); };
    t.appendChild(label);
    t.appendChild(x);
    t.title = b.file;
    t.onclick = () => activateBuffer(i);
    t.oncontextmenu = (e) => { e.preventDefault(); window.scriptify.showContext('editor', {}); };
    strip.appendChild(t);
  });
}

function initEditor() {
  try {
    if (window.ace && $('ace-editor')) {
      aceEditor = window.ace.edit('ace-editor');
      aceEditor.setTheme('ace/theme/github');
      aceEditor.session.setMode('ace/mode/javascript');
      aceEditor.setOptions({ fontSize: 13, showPrintMargin: false, wrap: true });
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
  openBuffer('hello-world.js', HELLO_TEMPLATE);
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
      label.onclick = () => openLocalFile(s.file);
    const more = document.createElement('button');
    more.className = 'mini more';
    more.textContent = '⋯';
    more.title = 'More actions (right-click works too)';
    more.onclick = (e) => { e.stopPropagation(); window.scriptify.showContext('local', { file: s.file }); };
    li.appendChild(star);
    li.appendChild(label);
    li.appendChild(more);
    li.oncontextmenu = (e) => { e.preventDefault(); window.scriptify.showContext('local', { file: s.file }); };
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
    mcpTitles = r.success ? (r.data || []) : [];
    if (!r.success) mcpList.innerHTML = `<li class="err">${escapeHtml(r.error)}</li>`;
    else if (!r.data.length) mcpList.innerHTML = '<li>(nothing in Affinity library)</li>';
    for (const title of (r.data || [])) {
      const li = document.createElement('li');
      li.className = 'script-row';
      const t = document.createElement('span');
      t.className = 'script-label';
      t.textContent = title;
      t.onclick = async () => {
        const res = await window.scriptify.downloadFromMcp(title);
        output.textContent = res.success ? `Downloaded "${title}" to local library. Refreshing…` : `Download failed: ${res.error}`;
        if (res.success) refreshLists();
      };
      li.title = 'Click to download to local library';
      li.appendChild(t);
      const more = document.createElement('button');
      more.className = 'mini more';
      more.textContent = '⋯';
      more.title = 'More actions';
      more.onclick = (e) => { e.stopPropagation(); window.scriptify.showContext('mcp', { title }); };
      li.appendChild(more);
      li.oncontextmenu = (e) => { e.preventDefault(); window.scriptify.showContext('mcp', { title }); };
      mcpList.appendChild(li);
    }
  } catch (e) { mcpList.innerHTML = `<li class="err">${escapeHtml(e.message)}</li>`; }
  renderPropCard();
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
    label.onclick = (e) => { e.stopPropagation(); window.scriptify.showContext('community', { script: s }); };
    li.appendChild(star);
    li.appendChild(label);
    const more = document.createElement('button');
    more.className = 'mini more';
    more.textContent = '⋯';
    more.title = 'More actions (right-click works too)';
    more.onclick = (e) => { e.stopPropagation(); window.scriptify.showContext('community', { script: s }); };
    li.appendChild(more);
    li.oncontextmenu = (e) => { e.preventDefault(); window.scriptify.showContext('community', { script: s }); };
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

const SIDEPANES = ['mine', 'affinity', 'discover', 'settings'];
function showSide(which) {
  for (const p of SIDEPANES) {
    $('side-' + p).classList.toggle('active', p === which);
    $('sidepane-' + p).style.display = p === which ? 'block' : 'none';
  }
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

// ---- command palette (Ctrl/Cmd+K) ----
const COMMANDS = [
  { id: 'refresh', label: 'Refresh all lists', run: () => $('btn-refresh').click() },
  { id: 'new', label: 'New script from template', run: () => $('btn-new').click() },
  { id: 'save', label: 'Save active buffer locally', run: () => $('btn-save').click() },
  { id: 'run', label: 'Run in Affinity', run: () => $('btn-run').click() },
  { id: 'install', label: 'Save + Install to Affinity', run: () => $('btn-install').click() },
  { id: 'preview', label: 'Preview active Affinity document', run: () => $('btn-preview').click() },
  { id: 'copy-prompt', label: 'Copy prompt for OpenCode', run: () => $('btn-copy-prompt').click() },
  { id: 'side-mine', label: 'Go to My scripts', run: () => showSide('mine') },
  { id: 'side-affinity', label: 'Go to Affinity library', run: () => showSide('affinity') },
  { id: 'side-discover', label: 'Go to Community', run: () => { showSide('discover'); refreshCommunity(); } },
  { id: 'side-settings', label: 'Go to Settings', run: () => showSide('settings') },
  { id: 'docs-refresh', label: 'Refresh SDK docs', run: () => { showTabs('docs'); refreshDocs(); } },
  { id: 'studio', label: 'Open AI Studio', run: () => { showTabs('studio'); refreshAiStatus(); } },
  { id: 'studio-generate', label: 'Studio: generate script', run: () => { showTabs('studio'); studioGenerate(); } },
  { id: 'watch', label: 'Toggle Watch Mode', run: () => { watchToggle.checked = !watchToggle.checked; watchToggle.onchange(); } },
  { id: 'updates', label: 'Check for app updates', run: () => { showSide('settings'); $('btn-check-updates').click(); } },
  { id: 'search-local', label: 'Search local scripts…', run: () => { showSide('mine'); localSearch.focus(); } }
];
let paletteActive = 0;

function openPalette() {
  $('palette').style.display = 'block';
  $('palette-input').value = '';
  paletteActive = 0;
  paletteItems = renderPalette('');
  $('palette-input').focus();
}

function closePalette() {
  $('palette').style.display = 'none';
}

function renderPalette(q) {
  const query = q.trim().toLowerCase();
  const items = COMMANDS.filter((c) => !query || c.label.toLowerCase().includes(query));
  paletteActive = Math.min(paletteActive, Math.max(0, items.length - 1));
  const ul = $('palette-list');
  ul.innerHTML = '';
  if (!items.length) { ul.innerHTML = '<li>(no matches)</li>'; return []; }
  items.forEach((c, i) => {
    const li = document.createElement('li');
    li.textContent = c.label;
    if (i === paletteActive) li.className = 'active';
    li.onclick = () => { closePalette(); c.run(); };
    ul.appendChild(li);
  });
  return items;
}

let paletteItems = [];
$('palette-input').addEventListener('input', (e) => { paletteActive = 0; paletteItems = renderPalette(e.target.value); });
$('palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteActive = Math.min(paletteActive + 1, paletteItems.length - 1); renderPalette(e.target.value); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteActive = Math.max(paletteActive - 1, 0); renderPalette(e.target.value); }
  else if (e.key === 'Enter') { e.preventDefault(); const c = paletteItems[paletteActive]; closePalette(); if (c) c.run(); }
  else if (e.key === 'Escape') closePalette();
});
$('btn-refresh').onclick = async () => { await refreshStatus(); await refreshLists(); await refreshRepos(); };
$('btn-new').onclick = () => { openBuffer('hello-world.js', HELLO_TEMPLATE); output.textContent = 'Template opened in a new tab. Edit, Save, then Run.'; };

$('btn-save').onclick = async () => {
  const fn = (filenameInput.value || 'untitled.js').trim();
  const b = activeBuffer();
  const oldFile = b ? b.file : null;
  // Renamed in the topbar? Make Save-As explicit — no silent forks.
  if (oldFile && oldFile !== fn && localCache.some((s) => s.file === oldFile)) {
    if (!confirm(`Save as "${fn}"? The original "${oldFile}" stays in your library.\n\nOK = save a new file · Cancel = don't save\n(Tip: right-click the row → Rename to retitle instead.)`)) return;
  }
  const r = await window.scriptify.saveLocal(fn, getCode());
  output.textContent = r.success ? `Saved ${fn} locally.` : `Save failed: ${r.error}`;
  if (r.success) {
    if (b) b.file = fn;
    // Collapse any other tab holding the same filename — one file, one tab.
    for (let i = buffers.length - 1; i >= 0; i--) {
      if (i !== activeIdx && buffers[i].file === fn) buffers.splice(i, 1);
    }
    activeIdx = buffers.indexOf(b);
    markActiveClean();
    setSelected(fn);
    refreshLists();
  }
};
$('editor-fallback').addEventListener('input', () => {
  const b = activeBuffer();
  if (b) { b.code = $('editor-fallback').value; if (!b.dirty) { b.dirty = true; renderBufferTabs(); } }
});

$('btn-run').onclick = async () => {
  output.textContent = 'Running in Affinity…';
  setDrawer(true);
  const t0 = Date.now();
  const r = await window.scriptify.execute(getCode());
  runTime.textContent = `(${(Date.now() - t0) / 1000}s)`;
  output.textContent = r.success ? (r.output || '(no output — script ran, nothing logged)') : `Run failed: ${r.error}`;
  if (r.success && $('preview-on-run').checked) renderPreviewToPanel(true);
};

$('btn-install').onclick = async () => {
  const fn = (filenameInput.value || 'untitled.js').trim();
  const s = await window.scriptify.saveLocal(fn, getCode());
  if (!s.success) { output.textContent = `Save failed: ${s.error}`; return; }
  const p = await window.scriptify.pushToMcp(fn);
  output.textContent = p.success ? `Installed ${fn} to Affinity library.` : `Saved locally, install failed: ${p.error}`;
  refreshLists();
};

$('btn-preview').onclick = () => renderPreviewToPanel(false);

let lastPreview = '';
let prevPreview = '';
let previewZoomFit = true;

function showDrawerTab(which) {
  const consoleTab = which === 'console';
  $('dt-console').classList.toggle('active', consoleTab);
  $('dt-preview').classList.toggle('active', !consoleTab);
  $('drawer-console').style.display = consoleTab ? 'block' : 'none';
  $('drawer-preview').style.display = consoleTab ? 'none' : 'block';
}

function setDrawer(open) {
  $('drawer').classList.toggle('closed', !open);
  $('btn-drawer').textContent = open ? '▾' : '▸';
}

async function renderPreviewToPanel(auto) {
  setDrawer(true);
  showDrawerTab('preview');
  $('preview-empty').textContent = auto ? 'Rendering after run…' : 'Rendering active document…';
  const r = await window.scriptify.renderPreview();
  if (r.success) {
    if (lastPreview) prevPreview = lastPreview;
    lastPreview = r.image;
    previewImg.src = r.image;
    previewImg.style.display = 'block';
    $('preview-empty').style.display = 'none';
    $('btn-preview-compare').disabled = !prevPreview;
    output.textContent = 'Preview rendered in the Preview tab.';
  } else {
    $('preview-empty').textContent = 'Preview failed: ' + r.error + ' (needs an open document + render_spread support)';
    $('preview-empty').style.display = 'block';
    output.textContent = 'Preview failed: ' + r.error;
  }
}

$('btn-docs').onclick = refreshDocs;
$('btn-search').onclick = searchHints;
docsSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchHints(); });
tabDocs.onclick = () => showTabs('docs');
tabStudio.onclick = () => { showTabs('studio'); refreshAiStatus(); };
for (const p of SIDEPANES) $('side-' + p).onclick = () => showSide(p);
$('btn-drawer').onclick = () => setDrawer($('drawer').classList.contains('closed'));
$('dt-console').onclick = () => showDrawerTab('console');
$('dt-preview').onclick = () => showDrawerTab('preview');
$('btn-preview-zoom').onclick = (e) => {
  previewZoomFit = !previewZoomFit;
  previewImg.style.width = previewZoomFit ? '100%' : 'auto';
  previewImg.style.maxWidth = previewZoomFit ? '100%' : 'none';
  e.target.textContent = previewZoomFit ? 'Fit' : '100%';
  window.scriptify.setUiPrefs({ previewZoom: previewZoomFit ? 'fit' : 'full' });
};
$('btn-preview-compare').onclick = (e) => {
  if (!prevPreview) return;
  const showingBefore = previewImg.src === lastPreview && prevPreview;
  previewImg.src = showingBefore ? prevPreview : lastPreview;
  e.target.textContent = showingBefore ? 'After' : 'Before';
};
$('preview-on-run').onchange = (e) => {
  window.scriptify.setUiPrefs({ previewOnRun: e.target.checked });
};
window.scriptify.getUiPrefs().then((r) => {
  if (!r.success) return;
  $('preview-on-run').checked = r.data.previewOnRun !== false;
  if (r.data.previewZoom === 'full') $('btn-preview-zoom').click();
}).catch(() => {});
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('palette').style.display === 'block') closePalette();
    else openPalette();
  }
});

$('btn-prop-save').onclick = async () => {
  if (!selectedFile) return;
  const r = await window.scriptify.updateScriptMeta(selectedFile, {
    name: $('prop-in-name').value.trim(),
    description: $('prop-in-desc').value.trim(),
    version: $('prop-in-ver').value.trim()
  });
  output.textContent = r.success ? `Metadata saved for ${selectedFile}.` : `Save failed: ${r.error}`;
  if (r.success) refreshLists();
};
$('btn-prop-bump').onclick = () => {
  $('prop-in-ver').value = bumpPatch($('prop-in-ver').value);
  $('btn-prop-save').click();
};
$('btn-update-repo').onclick = async () => {  const r = await window.scriptify.setUpdateRepo(updateRepoInput.value.trim());
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

// ---- context-menu actions (also used by row buttons) ----
async function openLocalFile(file) {
  const res = await window.scriptify.readLocal(file);
  if (res.success) { openBuffer(file, res.data.code); output.textContent = `Loaded ${file}`; }
  else output.textContent = `Open failed: ${res.error}`;
}

async function installLocalFile(file) {
  const p = await window.scriptify.pushToMcp(file);
  output.textContent = p.success ? `Installed ${file} to Affinity library.` : `Install failed: ${p.error}`;
  refreshLists();
}

async function favoriteFile(file) {
  const r = await window.scriptify.toggleFavorite(file);
  if (r.success) { favorites = new Set(r.data); renderLocal(); renderCommunity(); }
}

async function promptForFile(file) {
  const res = await window.scriptify.readLocal(file);
  if (!res.success) { output.textContent = `Open failed: ${res.error}`; return; }
  const prompt = `You are helping with an Affinity V3 JS script.\nRules: plain .js only, metadata header with lowercase name:/description:, use require('/application'), console.log for output, no invented APIs.\nCurrent script (${file}):\n\`\`\`js\n${res.data.code}\n\`\`\`\nTask: `;
  try {
    await navigator.clipboard.writeText(prompt);
    output.textContent = `Prompt for ${file} copied. Paste into OpenCode.`;
  } catch (e) { output.textContent = 'Copy failed: ' + e.message; }
}

window.scriptify.onContextAction(async ({ action, file, title, script }) => {
  if (action === 'local-open' && file) openLocalFile(file);
  else if (action === 'local-install' && file) installLocalFile(file);
  else if (action === 'local-export' && file) {
    const res = await window.scriptify.exportToDisk(file);
    output.textContent = res.success ? `Exported to ${res.data.path}` : `Export: ${res.error}`;
  } else if (action === 'local-rename' && file) {
    const next = prompt(`Rename ${file} → (without .js)`, file.replace(/\.js$/i, ''));
    if (!next) return;
    const res = await window.scriptify.renameLocal(file, next);
    output.textContent = res.success ? `Renamed to ${res.data.filename}` : `Rename failed: ${res.error}`;
    if (res.success) { syncBuffersAfterRename(file, res.data.filename); refreshLists(); }
  } else if (action === 'local-delete' && file) {
    if (!confirm(`Delete local ${file}? Affinity library copy stays — remove it in Affinity panel.`)) return;
    const res = await window.scriptify.deleteLocal(file);
    output.textContent = res.success ? `Deleted local ${file}.` : `Delete failed: ${res.error}`;
    if (res.success) { dropBuffersForDeleted(file); refreshLists(); }
  } else if (action === 'local-favorite' && file) favoriteFile(file);
  else if (action === 'local-prompt' && file) promptForFile(file);
  else if (action === 'community-install' && script) {
    output.textContent = `Installing "${script.name}"…`;
    const res = await window.scriptify.installCommunity(script);
    output.textContent = res.success
      ? (res.pushed ? `Installed "${script.name}".` : `Saved locally; Affinity push failed: ${res.pushError}`)
      : `Install failed: ${res.error}`;
    if (res.success) refreshLists();
  } else if (action === 'community-save' && script) {
    const res = await window.scriptify.saveCommunity(script);
    output.textContent = res.success ? `Saved "${script.name}" (local only).` : `Save failed: ${res.error}`;
    if (res.success) refreshLists();
  } else if (action === 'mcp-download' && title) {
    const res = await window.scriptify.downloadFromMcp(title);
    output.textContent = res.success ? `Downloaded "${title}".` : `Download failed: ${res.error}`;
    if (res.success) refreshLists();
  } else if (action === 'editor-save') $('btn-save').click();
  else if (action === 'editor-run') $('btn-run').click();
  else if (action === 'editor-install') $('btn-install').click();
  else if (action === 'editor-prompt') copyPrompt();
});

for (const id of ['ace-editor', 'editor-fallback']) {
  const el = $(id);
  if (el) el.addEventListener('contextmenu', (e) => { e.preventDefault(); window.scriptify.showContext('editor', {}); });
}
window.scriptify.getWatch().then((r) => { if (r.success) watchToggle.checked = r.enabled; }).catch(() => {});

initEditor();
initDrop();
refreshStatus();
refreshLists();
refreshRepos();
loadUpdateRepo();
