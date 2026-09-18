# Scriptify Affinity v0.7 (Phase 7: UX overhaul)

Maker + manager + editor for Affinity V3 scripts. OpenCode-assisted — now drivable BY agents over MCP.

## Prereqs
- Affinity 3.2+ with MCP connector enabled (`http://localhost:6767/sse`)
- In Affinity: allow MCP to save scripts, open `Window > General > Scripts`, create a category (e.g. `My Scripts`)
- Node 22+

## Run
```powershell
npm install
npm start
```

## Install (Windows)
Built installer: `dist/Scriptify Affinity Setup 0.7.0.exe` (NSIS, per-user, branded icon).
Rebuild with `npm run dist-win`.

## Agent access — Scriptify as an MCP server (Phase 6)
`npm run mcp-server` spawns a stdio MCP server sharing the GUI library. 12 tools:
`library_list/read/save/delete/rename`, `affinity_status/list_scripts/push/pull/run`, `docs_search/read`.
The GUI auto-refreshes when an agent saves (Watch Mode file watcher).

Connect from your agent (run from this folder so `node` resolves `node_modules`):
```powershell
# OpenCode — ~/.config/opencode/opencode.json
# { "mcp": { "scriptify": { "type": "local", "command": ["node", "C:\\path\\to\\scriptify-affinity\\mcp-server.js"], "enabled": true } } }
codex mcp add scriptify -- node C:\path\to\scriptify-affinity\mcp-server.js
claude mcp add scriptify -- node C:\path\to\scriptify-affinity\mcp-server.js
```
Env overrides: `SCRIPTIFY_DATA_DIR` (library location), `SCRIPTIFY_AFFINITY_URL` (bridge URL).
Agent loop: `docs_search` → `library_save` → `affinity_run` (verify output) → `affinity_push` (install).
`library_delete` removes the local file only — Affinity copies are removed in-app.

## What works (Phase 1 core + Phase 2 + Phase 3 + Phase 4)
- MCP status check (with preamble prime + reconnect-once)
- `list_library_scripts` → In Affinity list (click = download to local)
- Local library in Electron userData/MyScripts (save/read/list)
- `save_script_to_library` → Save + Install button
- `read_library_script` → Download button
- `execute_script` → Run in Affinity button (console.log output + timing)
- Ace editor (Monokai, JS mode, Ctrl/Cmd+S to save) with textarea fallback offline
- Watch Mode: saving an installed script auto-repushes it (toggle in header, events in Output)
- Docs column: Refresh SDK docs (cached to `docs-cache/*.md`), click topic to view, search SDK hints
- Copy prompt for OpenCode: bundles current buffer + rules to clipboard
- Community: default registry (Affinity-Community-Scripts), add/remove repos, Install (save+push) vs Save-only, repo error surfacing
- Local actions: export to disk (save dialog), rename, delete local (Affinity copy must be removed in panel)
- Brand: `brand assets/icon.ico` (256px multi-size) in installer + window + taskbar, `scriptify.png` logo in header
- Search: local filter + community filter (`Ctrl/Cmd+K` focuses local search)
- Favorites: star local + community scripts, shared set in `config.json`, favorites sort first
- Drag-drop: drop `.js` files anywhere → import, then choose Install or local-only
- Preview: Render active Affinity doc spread to JPEG below Output (needs open doc + `render_spread`)
- Updates: set GitHub `owner/repo`, manual check against latest release with link
- Sidebar tabs: Mine / Affinity / Discover / Settings (Figma-pages style)
- Property panel: metadata card with installed badge, inline edit + patch bump
- Preview tab: Console/Preview tabs, auto-render on Run, fit/100% zoom, before/after compare
- Context menus: right-click rows, cards and editor (native menus, same actions)
- Command palette: `Ctrl/Cmd+K` runs any action keyboard-first
- Editor tabs: up to 8 buffers with per-tab undo + dirty dots

## Notes
- Scripts do not return values — use `console.log()`.
- Cannot delete via MCP — delete in Affinity Scripts panel.
- Keep picker test files on Desktop (sandbox quirk).
- See `AGENTS.md` for OpenCode script rules, `templates/` for starters.
