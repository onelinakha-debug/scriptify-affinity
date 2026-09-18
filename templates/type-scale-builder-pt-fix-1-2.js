/**
 * name: Type Scale Builder 2.0
 * description: Generates a modular typography system from a base text size, using correct Affinity DPI pixel sizing (pt x dpi/72), real absolute leading, dual pt/px labels, per-role accent marks, optional baseline grid, ink/accent colour pickers, and a headless parameterised mode for automation.
 * version: 2.0.0
 * author: Seba + Scriptify
 */

'use strict';

const { Document } = require('/document');
const { Dialog, DialogResult } = require('/dialog');
const { UnitType } = require('/units');
const { Font } = require('/fonts');
const { StoryBuilder } = require('/storybuilder');
const { StoryDelta } = require('/storydelta');
const { GlyphAttDoubleType, GlyphAttStringType, LeadingOverrideType } = require('/glyphatts');
const { ParagraphAttStringType, ParagraphAttDoubleType, ParagraphLeadingType } = require('/paragraphatts');
const { AddChildNodesCommandBuilder } = require('/commands');
const { FrameTextNodeDefinition, ShapeNodeDefinition } = require('/nodes');
const { Rectangle } = require('/geometry');
const { ShapeRectangle } = require('/shapes');
const { FillDescriptor } = require('/fills');
const { SVG11, RGB8 } = require('/colours');

const SCALE_RULES = [
  { name: 'Minor Second', ratio: 1.067 },
  { name: 'Major Second', ratio: 1.125 },
  { name: 'Minor Third', ratio: 1.2 },
  { name: 'Major Third', ratio: 1.25 },
  { name: 'Perfect Fourth', ratio: 1.333 },
  { name: 'Golden Ratio', ratio: 1.618 },
  { name: 'Custom Ratio', ratio: null },
];

const ROUNDING_MODES = ['No rounding', 'Round to 0.5 pt', 'Round to 1 pt'];
const LINE_HEIGHT_MODES = ['Proportional', 'Compact headings', 'Baseline-friendly'];
const ROLE_INK = {
  caption: null, small: null, body: null, lead: null, heading: null, display: null,
};
ROLE_INK.caption = RGB8(120, 120, 120);
ROLE_INK.small = RGB8(90, 90, 90);
ROLE_INK.body = SVG11.black;
ROLE_INK.lead = SVG11.black;
ROLE_INK.heading = SVG11.black;
ROLE_INK.display = SVG11.black;

const DEFAULT_PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog.';
const CUSTOM_RATIO_INDEX = SCALE_RULES.length - 1;
const BODY_OFFSET = 2;
const MAX_SPECIMEN_ROWS = 32;
const BUILD_ID = '2.0.0';

const PREVIEW = {
  margin: 72,
  titleSize: 24,
  metaSize: 10,
  labelSize: 9,
  leftWidth: 230,
  accentBarW: 6,
  columnGap: 36,
  minRowHeight: 68,
  rowPadding: 18,
  dividerHeight: 0.75,
  baselineRule: 0.5,
  gridColumns: 2,
};

function pxFromPt(dpi, pt) { return pt * dpi / 72; }

function roundTo(value, places) {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function pad2(value) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return sign + (abs < 10 ? '0' : '') + abs;
}

function getStyleName(level) {
  const labels = ['Caption', 'Small', 'Body', 'Lead', 'Heading S', 'Heading M', 'Heading L', 'Heading XL', 'Display'];
  if (level >= 0 && level < labels.length) return 'Scale / ' + pad2(level) + ' ' + labels[level];
  if (level < 0) return 'Scale / ' + pad2(level) + ' Micro ' + Math.abs(level);
  return 'Scale / ' + pad2(level) + ' Display ' + (level - 7);
}

function getStyleRole(level) {
  if (level <= 0) return 'caption';
  if (level === 1) return 'small';
  if (level === 2) return 'body';
  if (level === 3) return 'lead';
  if (level >= 8) return 'display';
  return 'heading';
}

function normalizeSettings(doc, raw) {
  const roundingIndex = typeof raw.roundingMode === 'number'
    ? raw.roundingMode
    : Math.max(0, ROUNDING_MODES.indexOf(raw.roundingMode));
  const lhIndex = typeof raw.lineHeightMode === 'number'
    ? raw.lineHeightMode
    : Math.max(0, LINE_HEIGHT_MODES.indexOf(raw.lineHeightMode));
  return {
    doc,
    baseSize: Number(raw.baseSize) || 16,
    scaleRuleIndex: Math.max(0, Number(raw.scaleRuleIndex) || 0),
    customRatio: Number(raw.customRatio) || 1.25,
    stepsBelow: Math.max(0, Math.round(Number(raw.stepsBelow) || 0)),
    stepsAbove: Math.max(0, Math.round(Number(raw.stepsAbove) || 0)),
    roundingMode: ROUNDING_MODES[roundingIndex],
    lineHeightMode: LINE_HEIGHT_MODES[lhIndex],
    previewText: String(raw.previewText || DEFAULT_PREVIEW_TEXT),
    font: raw.font || Font.createDefault(),
    ink: raw.ink || null,
    accent: raw.accent || null,
    showBaseline: raw.showBaseline === true,
    tracking: Number(raw.tracking) || 0,
  };
}

function getUserSettings(doc) {
  const T = globalThis.__SCRIPTIFY_TEST__;
  if (T) return normalizeSettings(doc, T);

  const dialog = Dialog.create('Type Scale Builder 2.0');
  dialog.initialWidth = 440;

  const col = dialog.addColumn();
  const scaleGroup = col.addGroup('Scale');
  const baseSizeCtrl = scaleGroup.addUnitValueEditor('Base text size', UnitType.Number, UnitType.Number, 16, 1, 400);
  baseSizeCtrl.precision = 2;
  const scaleRuleCtrl = scaleGroup.addComboBox('Scale rule', SCALE_RULES.map(r => r.name + ' - ' + (r.ratio || 'custom')), 3);
  const customRatioCtrl = scaleGroup.addUnitValueEditor('Custom ratio', UnitType.Number, UnitType.Number, 1.25, 1.001, 4);
  customRatioCtrl.precision = 3;
  customRatioCtrl.isEnabled = false;

  const rangeGroup = col.addGroup('Range');
  const belowCtrl = rangeGroup.addUnitValueEditor('Steps below base', UnitType.Number, UnitType.Number, 2, 0, 20);
  belowCtrl.precision = 0;
  const aboveCtrl = rangeGroup.addUnitValueEditor('Steps above base', UnitType.Number, UnitType.Number, 5, 0, 24);
  aboveCtrl.precision = 0;

  const formatGroup = col.addGroup('Formatting');
  const fontCtrl = formatGroup.addFontPicker('Font');
  fontCtrl.font = Font.createDefault();
  fontCtrl.isFullWidth = true;
  const roundingCtrl = formatGroup.addComboBox('Rounding mode', ROUNDING_MODES, 1);
  const lineHeightCtrl = formatGroup.addComboBox('Line-height mode', LINE_HEIGHT_MODES, 0);
  const inkCtrl = formatGroup.addColourPicker('Primary ink', SVG11.black);
  const accentCtrl = formatGroup.addColourPicker('Accent', RGB8(227, 6, 19));
  const baselineCtrl = formatGroup.addCheckBox('Draw baseline grid', false);
  baselineCtrl.isFullWidth = true;
  const trackingCtrl = formatGroup.addUnitValueEditor('Tracking (per 1000 em)', UnitType.Number, UnitType.Number, 0, -1000, 1000);
  trackingCtrl.precision = 0;

  const textGroup = col.addGroup('Preview');
  const previewTextCtrl = textGroup.addTextBox('Preview text', DEFAULT_PREVIEW_TEXT);
  previewTextCtrl.isFullWidth = true;

  dialog.onControlValueChangedHandler = () => {
    customRatioCtrl.isEnabled = scaleRuleCtrl.selectedIndex === CUSTOM_RATIO_INDEX;
  };

  const res = dialog.runModal();
  const ok = res === DialogResult.Ok || res === DialogResult.Ok.value ||
             (res && res.value !== undefined && res.value === DialogResult.Ok.value);
  if (!ok) return null;
  const raw = {
      doc,
      baseSize: Number(baseSizeCtrl.value),
      scaleRuleIndex: scaleRuleCtrl.selectedIndex,
      customRatio: Number(customRatioCtrl.value),
      stepsBelow: Math.round(Number(belowCtrl.value)),
      stepsAbove: Math.round(Number(aboveCtrl.value)),
      roundingMode: roundingCtrl.selectedIndex,
      lineHeightMode: lineHeightCtrl.selectedIndex,
      previewText: String(previewTextCtrl.text || DEFAULT_PREVIEW_TEXT),
      font: fontCtrl.font || Font.createDefault(),
      ink: inkCtrl.value || null,
      accent: accentCtrl.value || null,
      showBaseline: baselineCtrl.value === true,
      tracking: Math.round(Number(trackingCtrl.value) || 0),
    };
  const settings = normalizeSettings(doc, raw);
  const error = validateSettings(settings);
  if (!error) return settings;
  alert(error);
  console.log('Type Scale Builder: ' + error);
  return null;
}

function getScaleRatio(settings) {
  const rule = SCALE_RULES[settings.scaleRuleIndex] || SCALE_RULES[3];
  return { ruleName: rule.name, ratio: rule.ratio || settings.customRatio };
}

function roundSize(value, roundingMode) {
  if (roundingMode === 'Round to 0.5 pt') return Math.round(value * 2) / 2;
  if (roundingMode === 'Round to 1 pt') return Math.round(value);
  return roundTo(value, 3);
}

function calculateLineHeight(size, step, mode) {
  const level = BODY_OFFSET + step;
  let multiplier;
  if (mode === 'Compact headings') {
    if (level <= 1) multiplier = 1.3;
    else if (level === 2) multiplier = 1.4;
    else if (level === 3) multiplier = 1.3;
    else if (level >= 8) multiplier = 0.98;
    else multiplier = 1.08;
  } else {
    if (level <= 1) multiplier = 1.35;
    else if (level === 2) multiplier = 1.45;
    else if (level === 3) multiplier = 1.35;
    else if (level >= 8) multiplier = 1.05;
    else multiplier = 1.15;
  }
  const lh = size * multiplier;
  if (mode === 'Baseline-friendly') return Math.max(4, Math.round(lh / 4) * 4);
  return roundTo(lh, 2);
}

function calculateTypeScale(settings) {
  const ratioInfo = getScaleRatio(settings);
  const rows = [];
  for (let step = -settings.stepsBelow; step <= settings.stepsAbove; step += 1) {
    const rawSize = step < 0
      ? settings.baseSize / Math.pow(ratioInfo.ratio, Math.abs(step))
      : settings.baseSize * Math.pow(ratioInfo.ratio, step);
    rows.push({
      step,
      size: roundSize(rawSize, settings.roundingMode),
      lineHeight: calculateLineHeight(roundSize(rawSize, settings.roundingMode), step, settings.lineHeightMode),
    });
  }
  const baseIndex = settings.stepsBelow;
  return rows.map((row, index) => {
    const styleLevel = index + BODY_OFFSET - baseIndex;
    const prev = index > 0 ? rows[index - 1].size : null;
    return {
      ...row,
      index,
      styleName: getStyleName(styleLevel),
      role: getStyleRole(styleLevel),
      upto: prev ? roundTo(Math.max(row.size, prev) / Math.min(row.size, prev), 3) : null,
    };
  });
}

function validateSettings(settings) {
  if (!settings.doc) return 'Open a document before running Type Scale Builder.';
  if (!Number.isFinite(settings.baseSize) || settings.baseSize <= 0) return 'Base text size must be a positive number.';
  if (settings.scaleRuleIndex === CUSTOM_RATIO_INDEX && (!Number.isFinite(settings.customRatio) || settings.customRatio <= 1)) return 'Custom ratio must be greater than 1.';
  if (!Number.isInteger(settings.stepsBelow) || settings.stepsBelow < 0) return 'Steps below base must be a non-negative integer.';
  if (!Number.isInteger(settings.stepsAbove) || settings.stepsAbove < 0) return 'Steps above base must be a non-negative integer.';
  if (settings.stepsBelow + settings.stepsAbove + 1 > MAX_SPECIMEN_ROWS) return 'Please generate ' + MAX_SPECIMEN_ROWS + ' styles or fewer.';
  return null;
}

function applyTextFormatting(storyBuilder, dpi, sizePx, lineHeightPx, styleName, font, tracking) {
  storyBuilder.applyGlyphDelta(StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, sizePx));
  if (font && font.isValid) {
    try { storyBuilder.applyGlyphDelta(StoryDelta.createPostscriptName(font.postscriptName)); }
    catch (e) {
      try { storyBuilder.applyGlyphDelta(StoryDelta.createFamilyName(font.familyName)); } catch (e2) {}
    }
  }
  storyBuilder.applyGlyphDelta(StoryDelta.createBrushFill(FillDescriptor.createSolid(SVG11.black)));
  if (tracking) storyBuilder.applyGlyphDelta(StoryDelta.createGlyphDouble(GlyphAttDoubleType.CharacterSpacing, tracking));
  if (styleName) {
    try { storyBuilder.applyParagraphDelta(StoryDelta.createParagraphString(ParagraphAttStringType.StyleName, styleName)); } catch (e) {}
  }
  const extra = lineHeightPx - sizePx;
  if (extra > 0) {
    try {
      storyBuilder.applyParagraphDelta(StoryDelta.createLeadingType(ParagraphLeadingType.ExactlyAbsolute));
      storyBuilder.applyParagraphDelta(StoryDelta.createParagraphDouble(ParagraphAttDoubleType.AbsoluteLeading, extra));
    } catch (e) {}
  }
  try {
    storyBuilder.applyGlyphDelta(StoryDelta.createLeadingOverrideType(LeadingOverrideType.AtLeast));
  } catch (e) {}
}

function addTextFrame(builder, dpi, text, rect, sizePt, lineHeightPt, styleName, font, tracking) {
  const sb = StoryBuilder.create();
  sb.setToFrameTextDefaultStyle(dpi, 0);
  applyTextFormatting(sb, dpi, pxFromPt(dpi, sizePt), pxFromPt(dpi, lineHeightPt), styleName, font, tracking);
  sb.addText(text);
  builder.addNode(FrameTextNodeDefinition.createFromStoryBuilder(rect, sb));
}

function addDivider(builder, x, y, width, height, colour) {
  builder.addShapeNode(ShapeNodeDefinition.create(
    ShapeRectangle.create(),
    new Rectangle(x, y, width, height),
    FillDescriptor.createSolid(colour),
  ));
}

function detectPreviewTarget(doc) {
  const selection = doc.selection;
  if (selection && selection.length > 0) {
    let node = selection.nodes.first;
    if (!node) { try { node = selection.at(0).node; } catch (e) {} }
    let depth = 0;
    while (node) {
      const ab = node.artboardInterface;
      if (ab && ab.isArtboardEnabled) {
        return { node, box: ab.baseBox };
      }
      node = node.parent;
      if (++depth > 14) break;
    }
  }
  const spread = doc.currentSpread || doc.spreads.first;
  let box = spread.getSpreadExtents ? spread.getSpreadExtents() : { x: 0, y: 0, width: doc.widthPixels, height: doc.heightPixels };
  return { node: spread, box };
}

function createPreviewPage(doc, settings, scale, preview) {
  const dpi = doc.dpi;
  function islandBaseline(lhPx) { return lhPx * 0.85; }
  const target = detectPreviewTarget(doc);
  const box = target.box;
  const builder = AddChildNodesCommandBuilder.create();
  builder.setInsertionTarget(target.node);

  const contentX = box.x + PREVIEW.margin;
  const contentY = box.y + PREVIEW.margin;
  const contentWidth = Math.max(420, box.width - PREVIEW.margin * 2);

  const ink = settings.ink || SVG11.black;
  const accent = settings.accent || RGB8(227, 6, 19);
  const inkDesc = FillDescriptor.createSolid(ink);

  addTextFrame(builder, dpi, 'TYPE SCALE SPECIMEN', { x: contentX, y: contentY, width: contentWidth, height: 42 }, PREVIEW.titleSize, PREVIEW.titleSize * 1.3, 'Scale / Title', settings.font, settings.tracking);
  addDivider(builder, contentX, contentY + 48, contentWidth, PREVIEW.dividerHeight, inkDesc);

  const ratioInfo = getScaleRatio(settings);
  const metaRows = [
    'Base  ' + roundTo(settings.baseSize, 2) + ' pt  (document ' + dpi + ' dpi)',
    'Ratio  ' + roundTo(ratioInfo.ratio, 4) + '  ·  ' + ratioInfo.ruleName,
    'Rounding  ' + settings.roundingMode,
    'Leading  ' + settings.lineHeightMode,
    'Steps  ' + settings.stepsBelow + ' below / ' + settings.stepsAbove + ' above  ·  ' + scale.length + ' styles',
    'Sizing  pt × ' + roundTo(dpi / 72, 3) + ' px  (Height in document pixels)',
    'Build  ' + BUILD_ID,
  ];
  addTextFrame(builder, dpi, metaRows.join('\n'), { x: contentX, y: contentY + 54, width: contentWidth, height: 120 }, PREVIEW.metaSize, 15, 'Scale / Meta', settings.font, settings.tracking);

  let y = contentY + 192;
  const rowsFinal = scale.slice().reverse().slice(0, MAX_SPECIMEN_ROWS);
  const baselineInk = FillDescriptor.createSolid(accent);

  for (const item of rowsFinal) {
    const previewHeight = Math.max(pxFromPt(dpi, item.lineHeight) * 1.55, PREVIEW.minRowHeight);
    const rowHeight = previewHeight + PREVIEW.rowPadding;

    addDivider(builder, contentX, y - 10, contentWidth, PREVIEW.dividerHeight, inkDesc);

    addDivider(builder, contentX, y - PREVIEW.minRowHeight / 2, PREVIEW.accentBarW, Math.max(rowHeight, 24), FillDescriptor.createSolid(ROLE_INK[item.role] || ink));

    const ratioLine = item.upto ? (roundTo(item.upto, 3) + '× from step ' + (item.step - 1)) : 'base size';
    addTextFrame(builder, dpi, item.styleName + '\n' + roundTo(item.size, 2) + ' pt  =  ' + Math.round(pxFromPt(dpi, item.size)) + ' px\n' + ratioLine, { x: contentX + PREVIEW.accentBarW + 8, y, width: PREVIEW.leftWidth, height: Math.max(rowHeight, 54) }, PREVIEW.labelSize, 13, 'Scale / Spec Label', settings.font, 0);

    addTextFrame(builder, dpi, settings.previewText, { x: contentX + PREVIEW.leftWidth + PREVIEW.columnGap, y, width: Math.max(240, contentWidth - PREVIEW.leftWidth - PREVIEW.columnGap), height: Math.max(rowHeight, pxFromPt(dpi, item.lineHeight) * 2.2) }, item.size, item.lineHeight, item.styleName, settings.font, settings.tracking);

    if (settings.showBaseline) {
      const bStart = y + islandBaseline(pxFromPt(dpi, item.lineHeight));
      addDivider(builder, contentX + PREVIEW.leftWidth + PREVIEW.columnGap, bStart, Math.max(240, contentWidth - PREVIEW.leftWidth - PREVIEW.columnGap), PREVIEW.baselineRule, baselineInk);
    }

    y += rowHeight;
  }

  doc.executeCommand(builder.createCommand(true));
  return scale.length;
}

function main() {
  try {
    const doc = Document.current;
    if (!doc) { alert('Open a document before running Type Scale Builder.'); console.log('Type Scale Builder: no document open.'); return; }
    const settings = getUserSettings(doc);
    if (!settings) return;
    const scale = calculateTypeScale(settings);
    const rows = createPreviewPage(doc, settings, scale, true);
    console.log('Type Scale Builder done: ' + rows + ' rows | base ' + roundTo(settings.baseSize, 2) + 'pt | ratio ' + roundTo(getScaleRatio(settings).ratio, 4) + ' | @' + doc.dpi + 'dpi');
  } catch (e) {
    alert('Type Scale Builder:\n' + (e && e.message ? e.message : e));
    console.log('Type Scale Builder ERROR: ' + (e && e.message ? e.message : e));
  }
}

main();