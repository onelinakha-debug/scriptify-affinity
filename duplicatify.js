/**
 * name: SDK Deep Probe v2
 * description: Read-only audit of the Affinity scripting API. Checks every module, enum and method the Scriptify library depends on, and reports which are present, working, or missing. Synchronous, safe, changes nothing.
 * version: 2.0.0
 * author: Scriptify
 */

const LIST = [];
function L(s) { LIST.push(s); console.log(s); }
function probe(label, fn) {
  try { const v = fn(); if (v === undefined || v === null) { L(label + ' → <undefined/null>'); return null; } L(label + ' → OK: ' + String(v).slice(0, 160)); return v; }
  catch (e) { L(label + ' → ERROR: ' + (e && e.message ? e.message : e)); return null; }
}
function keysOf(o) {
  if (!o) return [];
  try { return Object.getOwnPropertyNames(o); } catch (e) { return []; }
}
function surface(label, obj) {
  const k = keysOf(obj).filter(x => !['length', 'name', 'arguments', 'caller', 'prototype', 'entries', 'values', 'keys', 'parse', 'isEnum'].includes(x));
  L(label + ' (' + k.length + '): [' + k.join(', ') + ']');
}
function requireMod(name) {
  try { return require(name); }
  catch (e) { L('require("' + name + '") → MISSING: ' + e.message); return null; }
}
function enumValues(E) {
  if (!E) return [];
  return keysOf(E).filter(x => !['length', 'name', 'arguments', 'caller', 'prototype', 'entries', 'values', 'keys', 'parse', 'isEnum'].includes(x));
}

function main() {
  L('=== SDK Deep Probe v2.0.0 ===');

  // ---- Modules the Scriptify library depends on ----
  L('-- [1] Depends-on modules --');
  const mods = {
    '/application': null, '/document': null, '/dialog': null, '/units': null,
    '/commands': null, '/nodes': null, '/selections': null, '/shapes': null,
    '/geometry': null, '/storybuilder': null, '/storydelta': null,
    '/glyphatts': null, '/paragraphatts': null, '/fonts': null,
    '/fills': null, '/colours': null
  };
  for (const name of Object.keys(mods)) mods[name] = requireMod(name);
  const doc = Document.current;
  L(doc ? 'Document.current → OK' : 'Document.current → null');
  const dpi = doc ? probe('doc.dpi', () => doc.dpi) : null;
  L('doc.format (RasterFormat) = ' + (doc ? doc.format : 'n/a'));
  L('doc.units = ' + (doc ? String(doc.units) : 'n/a'));
  if (doc) probe('doc.widthPixels x heightPixels', () => doc.widthPixels.toFixed(1) + ' x ' + doc.heightPixels.toFixed(1));
  if (doc && doc.selection) L('doc.selection.length = ' + doc.selection.length);
  if (doc && doc.selection && doc.selection.length > 0) {
    const node = doc.selection.at(0).node;
    probe('selected node', () => node ? (node.name || node.constructor.name) : 'null');
    probe('selected node constructor', () => node ? node.constructor.name : 'null');
    probe('selected node spreadBaseBox', () => {
      const b = node.spreadBaseBox;
      return b ? ('x=' + b.x.toFixed(0) + ' y=' + b.y.toFixed(0) + ' w=' + b.width.toFixed(0) + ' h=' + b.height.toFixed(0)) : 'null';
    });
  }

  // ---- Statics on modules used by the calendar / grid / type-scale ----
  L('-- [2] Class surfaces --');
  const C = mods['/commands'];
  if (C) {
    surface('AddChildNodesCommandBuilder', C.AddChildNodesCommandBuilder);
    surface('DocumentCommand', C.DocumentCommand);
    surface('CompoundCommandBuilder', C.CompoundCommandBuilder);
  }
  const N = mods['/nodes'];
  if (N) {
    surface('ContainerNodeDefinition', N.ContainerNodeDefinition);
    surface('ShapeNodeDefinition', N.ShapeNodeDefinition);
    surface('FrameTextNodeDefinition', N.FrameTextNodeDefinition);
  }
  const SB = mods['/storybuilder'];
  if (SB && SB.StoryBuilder) {
    probe('StoryBuilder.create (static)', () => typeof SB.StoryBuilder.create);
    ['setToFrameTextDefaultStyle', 'setGlyphAtts', 'getGlyphAtts', 'applyGlyphDelta', 'setParagraphAtts', 'applyParagraphDelta', 'addText'].forEach(m =>
      probe('StoryBuilder.prototype.' + m, () => typeof SB.StoryBuilder.prototype[m]));
  }
  const SD = mods['/storydelta'];
  if (SD && SD.StoryDelta) {
    ['createGlyphDouble', 'createGlyphString', 'createParagraphDouble', 'createParagraphString', 'createBrushFill', 'createPostscriptName', 'createFamilyName', 'createLeadingType'].forEach(m =>
      probe('StoryDelta.' + m, () => typeof SD.StoryDelta[m]));
  }

  // ---- Enums with values that actually matter ----
  L('-- [3] Enums --');
  const Glyph = mods['/glyphatts'] && (mods['/glyphatts'].GlyphAttDoubleType);
  if (Glyph) { probe('GlyphAttDoubleType.Height', () => Glyph.Height); surface('GlyphAttDoubleType', Glyph); }
  const PAD = mods['/paragraphatts'] && (mods['/paragraphatts'].ParagraphAttDoubleType);
  if (PAD) { probe('ParagraphAttDoubleType.AbsoluteLeading', () => PAD.AbsoluteLeading); surface('ParagraphAttDoubleType', PAD); }
  const PLT = mods['/paragraphatts'] && (mods['/paragraphatts'].ParagraphLeadingType);
  if (PLT) {
    probe('ParagraphLeadingType.ExactlyAbsolute', () => PLT.ExactlyAbsolute);
    probe('ParagraphLeadingType.AtLeastAbsolute', () => PLT.AtLeastAbsolute);
  }
  const PAX = mods['/paragraphatts'] && (mods['/paragraphatts'].ParagraphAlignXType);
  if (PAX) {
    probe('ParagraphAlignXType.Left', () => PAX.Left);
    probe('ParagraphAlignXType.Centre', () => PAX.Centre);
    probe('ParagraphAlignXType.Right', () => PAX.Right);
  }
  const UT = mods['/units'] && mods['/units'].UnitType;
  if (UT) {
    probe('UnitType.Millimetre', () => UT.Millimetre);
    probe('UnitType.Pixel', () => UT.Pixel);
    probe('UnitType.Number', () => UT.Number);
  }
  const RF = mods['/document'] && mods['/document'].RasterFormat;
  if (RF) probe('RasterFormat.RGBA8', () => RF.RGBA8);

  // ---- StoryBuilder capability test (does setGlyphAtts round-trip?) ----
  L('-- [4] StoryBuilder capability test --');
  if (SB && SB.StoryBuilder && doc) {
    try {
      const s = SB.StoryBuilder.create();
      s.setToFrameTextDefaultStyle(doc.dpi, doc.format);
      const ga = s.glyphAtts;
      ga.height = dpi / 72 * 16;
      s.setGlyphAtts(ga);
      s.addText('probe');
      L('StoryBuilder create + setToFrameTextDefaultStyle + setGlyphAtts + addText → OK');
    } catch (e) { L('StoryBuilder test → ERROR: ' + e.message); }
  }

  // ---- Fonts ----
  L('-- [5] Fonts --');
  if (mods['/fonts']) {
    const F = mods['/fonts'];
    probe('FontFamily.all count', () => F.FontFamily.all.length);
    probe('Font.createDefault', () => {
      const f = F.Font.createDefault();
      return f ? ('valid=' + f.isValid + ' family=' + f.familyName) : 'null';
    });
  }

  L('=== END PROBE (' + LIST.length + ' lines) ===');
}

const { Document } = require('/document');
main();