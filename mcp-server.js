#!/usr/bin/env node
// mcp-server.js — Scriptify Affinity as an MCP *server* (stdio).
// Lets AI agents (OpenCode, Codex, Claude Code) drive the full script loop:
// manage the local library, push/pull/run scripts in Affinity via its MCP
// bridge, and search SDK docs — without the Electron GUI running.
//
//   npm run mcp-server
//   SCRIPTIFY_DATA_DIR=/path/to/data node mcp-server.js   (default: shared userData dir)
//   SCRIPTIFY_AFFINITY_URL=http://localhost:6767/sse node mcp-server.js
//
// NOTE: stdio is the MCP transport — never console.log here (use console.error).
const path = require('node:path');
const fs = require('node:fs/promises');
const core = require('./core');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const PKG = (() => { try { return require('./package.json'); } catch { return { version: '0.0.0' }; } })();

function ok(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function fail(error) {
  const msg = error && error.message ? error.message : String(error);
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

const TOOLS = [
  {
    name: 'library_list',
    description: 'List scripts in the local Scriptify library (file, title, description, version, size, modified).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'library_read',
    description: 'Read a local library script. Returns { filename, code }.',
    inputSchema: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] }
  },
  {
    name: 'library_save',
    description: 'Save code to the local library (creates or overwrites filename, must end .js). NO metadata header required — one is added only if title/description are passed.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        code: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['filename', 'code']
    }
  },
  {
    name: 'library_delete',
    description: 'Delete a LOCAL library file only. This never touches the Affinity library — Affinity copies must be removed in Affinity Window > General > Scripts.',
    inputSchema: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] }
  },
  {
    name: 'library_rename',
    description: 'Rename a local library file (newName without .js is fine).',
    inputSchema: { type: 'object', properties: { filename: { type: 'string' }, newName: { type: 'string' } }, required: ['filename', 'newName'] }
  },
  {
    name: 'affinity_status',
    description: 'Check the Affinity MCP bridge connection (http://localhost:6767/sse). Affinity must be running with the connector enabled.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'affinity_list_scripts',
    description: 'List script titles installed in the Affinity library.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'affinity_push',
    description: 'Install a local library file into Affinity (save_script_to_library). Affinity needs an existing Scripts-panel category.',
    inputSchema: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] }
  },
  {
    name: 'affinity_pull',
    description: 'Download an Affinity library script by title into the local library.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
  },
  {
    name: 'affinity_run',
    description: 'Run a script in Affinity WITHOUT installing it. Returns captured console.log output (scripts return no values).',
    inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] }
  },
  {
    name: 'docs_search',
    description: 'Search the shared pool of Affinity SDK hints. ALWAYS call this before writing a script from scratch.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'docs_read',
    description: 'Read one SDK documentation topic by filename (e.g. "preamble").',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] }
  }
];

async function main() {
  const dataDir = await core.resolveDataDir();
  const scriptsDir = path.join(dataDir, 'MyScripts');
  await fs.mkdir(scriptsDir, { recursive: true });
  console.error(`[scriptify-mcp] library: ${scriptsDir}`);

  const affinity = core.createAffinity(
    process.env.SCRIPTIFY_AFFINITY_URL || core.AFFINITY_SERVER_URL,
    'scriptify-mcp-server',
    PKG.version
  );

  async function listLocal() {
    const files = (await fs.readdir(scriptsDir)).filter((f) => f.endsWith('.js'));
    const out = [];
    for (const file of files) {
      const full = path.join(scriptsDir, file);
      const stat = await fs.stat(full);
      let meta = { name: path.parse(file).name, description: '', version: '' };
      try { meta = core.parseScriptMetadata((await fs.readFile(full, 'utf8')).slice(0, 4096), meta.name); } catch {}
      out.push({ file, ...meta, size: stat.size, modified: stat.mtimeMs });
    }
    return out;
  }

  const handlers = {
    library_list: async () => ok(await listLocal()),

    library_read: async ({ filename }) => {
      const safe = core.assertLocalFilename(filename);
      return ok({ filename: safe, code: await fs.readFile(path.join(scriptsDir, safe), 'utf8') });
    },

    library_save: async ({ filename, code, title, description }) => {
      const safe = core.assertLocalFilename(filename);
      let finalCode = String(code || '');
      if (title || description) {
        finalCode = core.upsertMetadataHeader(finalCode, {
          name: title || path.parse(safe).name,
          description: description || ''
        });
      }
      await fs.writeFile(path.join(scriptsDir, safe), finalCode, 'utf8');
      return ok({ saved: safe });
    },

    library_delete: async ({ filename }) => {
      const safe = core.assertLocalFilename(filename);
      await fs.unlink(path.join(scriptsDir, safe));
      return ok({ deleted: safe, note: 'Local file only. Remove any Affinity copy in Affinity > Scripts panel.' });
    },

    library_rename: async ({ filename, newName }) => {
      const from = core.assertLocalFilename(filename);
      const clean = String(newName || '').trim().replace(/\.js$/i, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
      if (!clean) throw new Error('Enter a valid new name.');
      const to = `${clean}.js`;
      if (from === to) return ok({ filename: to });
      try {
        await fs.access(path.join(scriptsDir, to));
        throw new Error(`A script named ${to} already exists.`);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      await fs.rename(path.join(scriptsDir, from), path.join(scriptsDir, to));
      return ok({ filename: to });
    },

    affinity_status: async () => {
      try {
        await affinity.ensureConnected();
        return ok({ connected: true, url: process.env.SCRIPTIFY_AFFINITY_URL || core.AFFINITY_SERVER_URL });
      } catch (e) {
        return ok({ connected: false, error: e.message, hint: 'Start Affinity 3.2+ and enable the MCP connector.' });
      }
    },

    affinity_list_scripts: async () => ok(core.parseTitles(await affinity.callTool('list_library_scripts', {}))),

    affinity_push: async ({ filename }) => {
      const safe = core.assertLocalFilename(filename);
      const code = await fs.readFile(path.join(scriptsDir, safe), 'utf8');
      const meta = core.parseScriptMetadata(code, path.parse(safe).name);
      await affinity.callTool('save_script_to_library', {
        title: meta.name || path.parse(safe).name,
        description: meta.description || '',
        code
      });
      return ok({ pushed: safe });
    },

    affinity_pull: async ({ title }) => {
      const res = await affinity.callTool('read_library_script', { title });
      const code = core.getTextContent(res);
      if (!code) throw new Error('Empty script returned.');
      const filename = core.safeFilename(title);
      await fs.writeFile(path.join(scriptsDir, filename), code, 'utf8');
      return ok({ pulled: title, filename });
    },

    affinity_run: async ({ script }) => {
      const res = await affinity.callTool('execute_script', { script });
      return ok({ output: core.getTextContent(res) });
    },

    docs_search: async ({ query }) => {
      const res = await affinity.callTool('search_sdk_hints', { prompt: String(query || '') });
      return ok(core.getTextContent(res) || JSON.stringify(res));
    },

    docs_read: async ({ topic }) => {
      const res = await affinity.callTool('read_sdk_documentation_topic', { filename: topic });
      return ok(core.getTextContent(res));
    }
  };

  const server = new Server(
    { name: 'scriptify-affinity', version: PKG.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler) return fail(`Unknown tool: ${name}`);
    try {
      return await handler(args || {});
    } catch (e) {
      return fail(e);
    }
  });

  server.onerror = (e) => console.error('[scriptify-mcp] error:', e && e.message);
  process.on('SIGINT', async () => { await affinity.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await affinity.close(); process.exit(0); });

  await server.connect(new StdioServerTransport());
  console.error('[scriptify-mcp] ready, 12 tools.');
}

main().catch((e) => {
  console.error('[scriptify-mcp] fatal:', e && e.message);
  process.exit(1);
});
