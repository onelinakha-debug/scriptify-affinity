// tests/renderer-buffers.test.js — boots renderer.js in a vm with DOM/Ace
// stubs and exercises the multi-buffer tab system, save-as guard,
// palette, drawer and tab-sync helpers. Run: npm test
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function makeEl(id) {
  const el = {
    id, children: [], listeners: {}, value: '', checked: false,
    disabled: false, src: '', title: '', textContent: '',
    style: {}, dataset: {},
    _classes: new Set(),
    classList: null,
    addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
    appendChild(c) { el.children.push(c); return c; },
    querySelector() { return makeEl(id + '-q'); },
    querySelectorAll() { return []; },
    focus() {},
    click() { if (typeof el.onclick === 'function') return el.onclick(); },
    remove() {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) { el._html = v; el.children = []; }
  });
  el.classList = {
    toggle(c, force) {
      if (force === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); }
      else if (force) el._classes.add(c); else el._classes.delete(c);
    },
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c),
    contains: (c) => el._classes.has(c)
  };
  return el;
}

function makeSession(code) {
  const handlers = {};
  return {
    code: String(code || ''), mode: '',
    setValue(v) { this.code = String(v); (handlers.change || []).forEach((f) => f()); },
    getValue() { return this.code; },
    setMode(m) { this.mode = m; },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
  };
}

async function boot() {
  const els = {};
  const calls = [];
  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    confirmResult: true,
    promptResult: null,
    confirm: (msg) => ctx.confirmResult,
    prompt: (msg, def) => (ctx.promptResult !== null ? ctx.promptResult : def),
    document: {
      getElementById: (id) => els[id] || (els[id] = makeEl(id)),
      createElement: (tag) => makeEl(tag),
      addEventListener() {}
    },
    window: null,
    navigator: { clipboard: { writeText: async () => {} } }
  };
  const editorStub = {
    _session: makeSession(''), theme: '', opts: {},
    setTheme(t) { this.theme = t; },
    setOptions(o) { this.opts = o; },
    get session() { return this._session; },
    setSession(s) { this._session = s; },
    getValue() { return this._session.getValue(); },
    commands: { addCommand() {} }
  };
  const okA = (data) => ({ success: true, data });
  ctx.window = {
    ace: {
      edit: () => editorStub,
      createEditSession: (c, m) => { const s = makeSession(c); s.setMode(m); return s; }
    },
    scriptify: {
      mcpStatus: async () => { calls.push(['mcpStatus']); return { success: true, connected: false, url: 'x' }; },
      getFavorites: async () => ({ success: true, data: [] }),
      listLocal: async () => ({ success: true, data: [] }),
      listMcp: async () => ({ success: true, data: [] }),
      getRepos: async () => ({ success: true, data: [] }),
      getUpdateRepo: async () => ({ success: true, data: '' }),
      getUiPrefs: async () => ({ success: true, data: { previewOnRun: true, previewZoom: 'fit' } }),
      getWatch: async () => ({ success: true, enabled: true }),
      readLocal: async (f) => { calls.push(['readLocal', f]); return { success: true, data: { code: '//content-of-' + f } }; },
      saveLocal: async (f, c) => { calls.push(['saveLocal', f, c]); return { success: true }; },
      renameLocal: async (f) => ({ success: true, data: { filename: 'renamed.js' } }),
      deleteLocal: async () => ({ success: true }),
      setUiPrefs: async () => ({ success: true }),
      execute: async () => ({ success: true, output: 'ok' }),
      renderPreview: async () => ({ success: false, error: 'no doc' }),
      onWatchPush() {}, onLibraryChanged() {}, onContextAction(fn) { ctx._ctxAction = fn; },
      showContext() {}
    },
    addEventListener() {}
  };
  ctx.window.window = ctx.window;
  // NOTE: do NOT set ctx.globalThis — it would shadow the VM intrinsic and
  // misdirect the probe below. Inside the context, globalThis === sandbox.
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const probe = '\n;globalThis.__t={b:()=>buffers,ai:()=>activeIdx,pa:()=>paletteActive,pi:()=>paletteItems,cache:(a)=>{localCache=a;},cmds:()=>COMMANDS};';
  vm.runInContext(src + probe, ctx);
  // let load-time async (refreshStatus/refreshLists/...) settle
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { ctx, els, calls, editorStub, T: ctx.__t };
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok - ' + name); }
  catch (e) { console.error('FAIL - ' + name + ': ' + e.message); process.exitCode = 1; }
}

(async () => {
  const { ctx, els, calls, T } = await boot();
  const noDialogs = () => { ctx.confirmResult = true; };

  await test('boot: single clean hello-world tab', () => {
    assert.strictEqual(T.b().length, 1);
    assert.strictEqual(T.b()[0].file, 'hello-world.js');
    assert.strictEqual(T.b()[0].dirty, false);
    assert.strictEqual(els['buffer-tabs'].children.length, 1);
    assert.strictEqual(els['filename'].value, 'hello-world.js');
  });

  await test('typing marks tab dirty with dot', () => {
    T.b()[0].session.setValue('// edited');
    assert.strictEqual(T.b()[0].dirty, true);
    assert.ok(els['buffer-tabs'].children[0].children[0].textContent.includes('●'));
  });

  await test('open second file preserves first buffer', async () => {
    vm.runInContext('openBuffer("b.js", "//b")', ctx);
    await tick();
    assert.strictEqual(T.b().length, 2);
    assert.strictEqual(T.b()[T.ai()].file, 'b.js');
    assert.strictEqual(T.b()[0].code, '// edited');
    vm.runInContext('activateBuffer(0)', ctx);
    assert.strictEqual(vm.runInContext('getCode()', ctx), '// edited');
  });

  await test('save-as guard blocks when confirm is false', async () => {
    noDialogs();
    els['filename'].value = 'c.js';
    T.cache([{ file: 'hello-world.js' }]);
    const before = calls.filter((c) => c[0] === 'saveLocal').length;
    ctx.confirmResult = false;
    await els['btn-save'].onclick();
    assert.strictEqual(calls.filter((c) => c[0] === 'saveLocal').length, before);
    ctx.confirmResult = true;
    await els['btn-save'].onclick();
    const saves = calls.filter((c) => c[0] === 'saveLocal');
    assert.strictEqual(saves.length, before + 1);
    assert.strictEqual(saves[saves.length - 1][1], 'c.js');
    assert.ok(!T.b().some((b) => b.file === 'hello-world.js') || T.b().length === 1);
  });

  await test('eviction removes first clean tab, keeps active intact', async () => {
    noDialogs();
    // state: [c.js, b.js] (both clean) -> add f1..f6 to reach cap of 8
    for (let i = 1; i <= 6; i++) vm.runInContext(`openBuffer("f${i}.js", "//f${i}")`, ctx);
    assert.strictEqual(T.b().length, 8);
    // dirty everything except f3, activate tab 0, then open one more
    T.b().forEach((b) => { if (b.file !== 'f3.js') b.session.setValue(b.session.getValue() + '-dirty'); });
    vm.runInContext('activateBuffer(0)', ctx);
    const activeContent = vm.runInContext('getCode()', ctx);
    vm.runInContext('openBuffer("f7.js", "//f7")', ctx);
    const files = T.b().map((b) => b.file);
    assert.strictEqual(files.length, 8);
    assert.ok(!files.includes('f3.js'), 'first clean tab evicted, got: ' + files);
    assert.strictEqual(T.b()[T.ai()].file, 'f7.js');
    const c = T.b().find((b) => b.file === 'c.js');
    assert.ok(c, 'active tab survived');
    assert.strictEqual(c.session.getValue(), activeContent);
  });

  await test('evicting the active tab cannot corrupt neighbors', async () => {
    noDialogs();
    T.b().forEach((b) => { if (!b.dirty) b.session.setValue(b.code + '-d'); });
    const before = {};
    T.b().forEach((b) => { before[b.file] = b.session.getValue(); });
    vm.runInContext('activateBuffer(0)', ctx);
    const victim = T.b()[0].file;
    vm.runInContext('openBuffer("fresh.js", "//fresh")', ctx);
    const after = {};
    T.b().forEach((b) => { after[b.file] = b.session.getValue(); });
    assert.ok(!(victim in after), 'evicted tab gone');
    for (const f of Object.keys(after)) {
      if (f === 'fresh.js') { assert.strictEqual(after[f], '//fresh'); continue; }
      assert.strictEqual(after[f], before[f], 'content drift in ' + f);
    }
    assert.strictEqual(T.b()[T.ai()].file, 'fresh.js');
  });

  await test('close dirty tab respects confirm', async () => {
    const n = T.b().length;
    const idx = T.b().findIndex((b) => b.dirty);
    assert.ok(idx >= 0, 'need a dirty tab');
    ctx.confirmResult = false;
    vm.runInContext(`closeBuffer(${idx})`, ctx);
    assert.strictEqual(T.b().length, n);
    ctx.confirmResult = true;
    const f = T.b()[idx].file;
    vm.runInContext(`closeBuffer(${idx})`, ctx);
    assert.ok(!T.b().some((b) => b.file === f));
  });

  await test('palette opens with all commands; Enter runs first', async () => {
    const before = calls.filter((c) => c[0] === 'mcpStatus').length;
    vm.runInContext('openPalette()', ctx);
    assert.strictEqual(els['palette'].style.display, 'block');
    assert.strictEqual(T.pi().length, T.cmds().length);
    assert.strictEqual(els['palette-list'].children.length, T.cmds().length);
    const input = els['palette-input'];
    for (const fn of input.listeners.keydown) await fn({ key: 'Enter', preventDefault() {} });
    await tick();
    assert.ok(calls.filter((c) => c[0] === 'mcpStatus').length > before, 'refresh ran via palette');
    assert.strictEqual(els['palette'].style.display, 'none');
  });

  await test('palette filters + arrow navigation', async () => {
    vm.runInContext('openPalette()', ctx);
    const input = els['palette-input'];
    input.value = 'watch';
    for (const fn of input.listeners.input) await fn({ target: input });
    assert.strictEqual(T.pi().length, 1);
    assert.ok(T.pi()[0].label.includes('Watch'));
  });

  await test('drawer tabs + collapse toggle', async () => {
    vm.runInContext('showDrawerTab("preview")', ctx);
    assert.strictEqual(els['drawer-preview'].style.display, 'block');
    assert.strictEqual(els['drawer-console'].style.display, 'none');
    vm.runInContext('setDrawer(false)', ctx);
    assert.ok(els['drawer']._classes.has('closed'));
    vm.runInContext('setDrawer(true)', ctx);
    assert.ok(!els['drawer']._classes.has('closed'));
    vm.runInContext('showDrawerTab("console")', ctx);
  });

  await test('rename/delete sync open tabs', async () => {
    vm.runInContext('openBuffer("old.js", "//old")', ctx);
    vm.runInContext('syncBuffersAfterRename("old.js", "new.js")', ctx);
    assert.ok(T.b().some((b) => b.file === 'new.js'));
    assert.ok(!T.b().some((b) => b.file === 'old.js'));
    vm.runInContext('dropBuffersForDeleted("new.js")', ctx);
    assert.ok(!T.b().some((b) => b.file === 'new.js' && !b.dirty));
  });

  await test('context action local-open loads file into a tab', async () => {
    await ctx._ctxAction({ action: 'local-open', file: 'z.js' });
    await tick();
    assert.ok(T.b().some((b) => b.file === 'z.js'));
    assert.ok(calls.some((c) => c[0] === 'readLocal' && c[1] === 'z.js'));
  });

  console.log(`\n${passed} tests passed.`);
})().catch((e) => { console.error('HARNESS-FAIL:', e); process.exit(1); });
