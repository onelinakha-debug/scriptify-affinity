# Scriptify Affinity — OpenCode Assistant Guide

You are helping the user write **Affinity V3 JavaScript scripts**.
Affinity 3.2+ exposes scripting via an in-app JS runtime + a local MCP bridge at `http://localhost:6767/sse`.

## Hard rules
1. Output plain Affinity `.js` scripts only. No HTML unless asked.
2. Start every file with a metadata header block:
```js
/**
 * name: Script Title
 * description: One or two sentences on what it does.
 * version: 0.1.0
 * author: Scriptify
 */
```
- Tag names must be lowercase. `/**` must be first line.
3. Minimal runtime pattern (verified against Affinity 3.2):
```js
const { app } = require('/application');
app.alert('Hello, World!');
```
4. Scripts do NOT return values. Use `console.log()` for output — the host captures it as execution output.
5. Prefer documented SDK modules: `/application`, `/document`. Do not invent APIs. If unsure, ask to run `extract-docs` / check `docs-cache/` or call `search_sdk_hints`.
6. File picker sandbox: tell users to keep input files on Desktop when using file dialogs.
7. Never suggest deleting via MCP — deletion must be done in Affinity `Window > General > Scripts` panel.

## MCP tools (via Electron main, not directly in scripts)
- `list_library_scripts` — list installed titles
- `save_script_to_library` { title, description, code } — install/push
- `read_library_script` { title } — pull code
- `execute_script` { script } — run without installing, returns console.log text

## Workflow for new scripts
1. Ask what the script should automate (layers, text, export, batch?).
2. Draft code using `templates/` as style reference.
3. Ensure metadata header + `console.log('Done …')` at end.
4. Tell user: paste into Scriptify Editor → Run → Install when happy.

## Repo layout
- `main.js` — Electron GUI (IPC handlers, Watch Mode, AI Studio, updates)
- `core.js` — shared logic (metadata, config, Affinity SSE client). No Electron imports.
- `mcp-server.js` — stdio MCP server: the agentic loop without the GUI
- `preload.js` — safe `window.scriptify` bridge
- `renderer.js` / `index.html` — sidebar / stage / inspector layout
- `templates/` — starter scripts compatible with header parser
- `docs-cache/` — extracted SDK markdown (gitignored, refresh via Docs tab)

## Scriptify MCP server (for agents driving this app)
Spawn via `npm run mcp-server` (shares the GUI library dir). 12 tools:
- `library_list / library_read / library_save / library_delete / library_rename` — local files only
- `affinity_status / affinity_list_scripts / affinity_push / affinity_pull / affinity_run` — via Affinity bridge
- `docs_search / docs_read` — SDK hints + topics
Rules: `docs_search` BEFORE writing from scratch. `affinity_run` to verify (returns console output). `library_save` then `affinity_push` to install. `library_delete` removes the local file only — Affinity copies are removed by the user in-app. Never claim an Affinity delete capability.
