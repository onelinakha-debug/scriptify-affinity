// core.js — shared logic for the Electron GUI (main.js) and the headless
// MCP server (mcp-server.js). No Electron imports here so plain node can use it.
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');

const DEFAULT_REPO = 'https://raw.githubusercontent.com/JiriKrblich/Affinity-Community-Scripts/refs/heads/main/registry.json';
const AFFINITY_SERVER_URL = 'http://localhost:6767/sse';

// ---- MCP result helpers ----
function getTextContent(result) {
  return (result.content || [])
    .filter((i) => i && i.type === 'text' && typeof i.text === 'string')
    .map((i) => i.text)
    .join('\n');
}

function parseTitles(result) {
  const text = getTextContent(result);
  return [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];
}

function getImageDataUrl(result) {
  const items = (result && result.content) || [];
  const img = items.find((i) => i && i.type === 'image' && i.data);
  if (img) return `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`;
  const text = getTextContent(result).trim();
  if (!text) return '';
  return text.startsWith('data:') ? text : `data:image/jpeg;base64,${text}`;
}

// ---- script metadata header ----
function readMetadataField(header, field) {
  const m = header.match(new RegExp(`^\\s*\\*?\\s*${field}:\\s*(.*)$`, 'im'));
  return m ? m[1].trim() : '';
}

function parseScriptMetadata(code, fallbackName = '') {
  const meta = { name: fallbackName, description: '', version: '', author: '' };
  const h = String(code || '').match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!h) return meta;
  meta.name = readMetadataField(h[1], 'name') || meta.name;
  meta.description = readMetadataField(h[1], 'description');
  meta.version = readMetadataField(h[1], 'version');
  meta.author = readMetadataField(h[1], 'author');
  return meta;
}

function metadataValue(v) {
  return String(v || '').replace(/\s*\n+\s*/g, ' ').trim();
}

function upsertMetadataHeader(code, metadata) {
  const fields = {
    name: metadataValue(metadata.name),
    description: metadataValue(metadata.description),
    version: metadataValue(metadata.version),
    author: metadataValue(metadata.author)
  };
  const present = Object.entries(fields).filter(([, v]) => v);
  if (!present.length) return code;
  const source = String(code || '');
  const m = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!m) {
    return '/**\n' + present.map(([k, v]) => ` * ${k}: ${v}`).join('\n') + '\n */\n\n' + source.replace(/^\s+/, '');
  }
  let header = m[1];
  for (const [k, v] of present) {
    const re = new RegExp(`(^\\s*\\*?\\s*${k}:\\s*).*$`, 'im');
    header = re.test(header) ? header.replace(re, (_l, p) => `${p}${v}`) : header + `\n * ${k}: ${v}`;
  }
  return source.replace(m[0], `/**${header}*/`);
}

function safeFilename(title) {
  const base = String(title || 'untitled').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
  return `${base}.js`;
}

function assertLocalFilename(filename) {
  const safe = path.basename(String(filename || ''));
  if (!safe.endsWith('.js')) throw new Error('Filename must end with .js');
  if (safe !== String(filename)) throw new Error('Invalid filename (no paths allowed).');
  return safe;
}

function fetchFresh(url, options = {}) {
  const sep = url.includes('?') ? '&' : '?';
  return fetch(`${url}${sep}_cb=${Date.now()}`, {
    cache: 'no-store',
    ...options,
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', ...(options.headers || {}) }
  });
}

// ---- config store (config.json next to the library) ----
async function getConfig(configPath, extraDefaults = {}) {
  let config = {};
  try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); } catch {}
  let dirty = false;
  const ensure = (key, value) => {
    if (config[key] === undefined) { config[key] = value; dirty = true; }
  };
  if (!Array.isArray(config.repositories)) { config.repositories = [DEFAULT_REPO]; dirty = true; }
  else if (!config.repositories.includes(DEFAULT_REPO)) { config.repositories.unshift(DEFAULT_REPO); dirty = true; }
  ensure('favoriteScripts', []);
  if (!Array.isArray(config.favoriteScripts)) { config.favoriteScripts = []; dirty = true; }
  ensure('updateRepo', '');
  for (const [k, v] of Object.entries(extraDefaults)) ensure(k, v);
  if (dirty) await saveConfig(configPath, config);
  return config;
}

async function saveConfig(configPath, config) {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// ---- data dir: GUI (Electron userData) and headless server must share one ----
// Env override wins (tests, custom setups). Otherwise first existing candidate,
// else the primary candidate (created by caller).
function resolveDataDirCandidates() {
  if (process.env.SCRIPTIFY_DATA_DIR) return [process.env.SCRIPTIFY_DATA_DIR];
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    path.join(appData, 'Scriptify Affinity'),
    path.join(appData, 'scriptify-affinity')
  ];
}

async function resolveDataDir() {
  const fsSync = require('node:fs');
  for (const dir of resolveDataDirCandidates()) {
    try {
      if (fsSync.existsSync(path.join(dir, 'MyScripts')) || fsSync.existsSync(path.join(dir, 'config.json'))) return dir;
    } catch {}
  }
  return resolveDataDirCandidates()[0];
}

// ---- Affinity MCP client (SSE + preamble prime + reconnect-once) ----
function createAffinity(serverUrl = AFFINITY_SERVER_URL, clientName = 'scriptify', clientVersion = '1.0.0') {
  let client = null;
  let transport = null;
  let connected = false;
  let connectPromise = null;

  async function ensureConnected() {
    if (connected && client && transport) return;
    if (connectPromise) return connectPromise;
    connectPromise = (async () => {
      try {
        if (transport) { try { await transport.close(); } catch {} }
        client = new Client({ name: clientName, version: clientVersion });
        transport = new SSEClientTransport(new URL(serverUrl));
        await client.connect(transport);
        // Affinity requires reading the preamble once per session before
        // other SDK-doc tools return real data. Prime best-effort.
        try {
          await client.request(
            { method: 'tools/call', params: { name: 'read_sdk_documentation_topic', arguments: { filename: 'preamble' } } },
            CallToolResultSchema
          );
        } catch (e) {
          console.warn('[MCP] preamble prime failed:', e.message);
        }
        connected = true;
      } catch (err) {
        connected = false;
        throw err;
      } finally {
        connectPromise = null;
      }
    })();
    return connectPromise;
  }

  function isRecoverable(err) {
    const msg = err && err.message ? err.message : String(err);
    return /session not initialized|session not found|not connected|disconnected|closed|http 404/i.test(msg);
  }

  async function callTool(name, args) {
    await ensureConnected();
    try {
      return await client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema);
    } catch (err) {
      if (isRecoverable(err)) {
        connected = false;
        await ensureConnected();
        return client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema);
      }
      throw err;
    }
  }

  async function close() {
    try { if (transport) await transport.close(); } catch {}
    connected = false;
    client = null;
    transport = null;
  }

  return { ensureConnected, callTool, close, get connected() { return connected; } };
}

module.exports = {
  DEFAULT_REPO,
  AFFINITY_SERVER_URL,
  getTextContent,
  parseTitles,
  getImageDataUrl,
  readMetadataField,
  parseScriptMetadata,
  metadataValue,
  upsertMetadataHeader,
  safeFilename,
  assertLocalFilename,
  fetchFresh,
  getConfig,
  saveConfig,
  resolveDataDirCandidates,
  resolveDataDir,
  createAffinity
};
