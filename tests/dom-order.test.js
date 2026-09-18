// tests/dom-order.test.js — renderer.js is a classic (non-deferred) script:
// every element it touches at load time must be parsed BEFORE the script
// tag, or getElementById returns null and the whole UI dies silently.
// Run: npm test
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptIdx = html.indexOf('<script src="renderer.js">');
assert.ok(scriptIdx > 0, 'renderer script tag missing');

const late = [];
const re = /id="([\w-]+)"/g;
let m;
while ((m = re.exec(html))) {
  if (m.index > scriptIdx) late.push(m[1]);
}
assert.strictEqual(late.length, 0, 'elements parsed AFTER renderer.js (null at boot): ' + late.join(', '));
console.log('ok - script tag is last; all elements parse before renderer boot');
