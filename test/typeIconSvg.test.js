// test/typeIconSvg.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTypeIconSvg, DEFAULT_TYPE_ICONS } = require('../out/typeIconSvg');

test('renders an SVG containing the fill color and the abbreviation text', () => {
  const svg = renderTypeIconSvg('CL', '#2ea043');
  assert.match(svg, /<svg/);
  assert.match(svg, /fill="#2ea043"/);
  assert.match(svg, />CL<\/text>/);
});

test('uppercases and truncates the abbreviation to 2 characters', () => {
  const svg = renderTypeIconSvg('clx', '#2ea043');
  assert.match(svg, />CL<\/text>/);
});

test('renders a single-letter abbreviation as-is', () => {
  const svg = renderTypeIconSvg('P', '#a1682a');
  assert.match(svg, />P<\/text>/);
});

test('clean (non-dirty) icon has no red border stroke', () => {
  const svg = renderTypeIconSvg('CL', '#2ea043');
  assert.doesNotMatch(svg, /stroke="#f14c4c"/);
});

test('dirty icon draws a red box around the type icon without changing its own color', () => {
  const svg = renderTypeIconSvg('CL', '#2ea043', { dirty: true });
  assert.match(svg, /stroke="#f14c4c"/);
  assert.match(svg, /fill="#2ea043"/);
  assert.match(svg, />CL<\/text>/);
});

test('default type icon table covers every known object type plus the fallback', () => {
  const types = DEFAULT_TYPE_ICONS.map(entry => entry.type);
  for (const expected of [
    'CLAS', 'INTF', 'DDLS', 'DDLX', 'DCLS', 'SRVD', 'BDEF', 'SRVB',
    'TABL', 'STRU', 'TTYP', 'DTEL', 'DOMA', 'PROG', 'FUGR', 'INCL', 'FUNC', 'UNKNOWN',
  ]) {
    assert.ok(types.includes(expected), `missing default icon entry for ${expected}`);
  }
  assert.equal(types.length, 18);
});

test('default entries all have a 1-2 character abbreviation and a hex color', () => {
  for (const entry of DEFAULT_TYPE_ICONS) {
    assert.ok(entry.abbreviation.length >= 1 && entry.abbreviation.length <= 2, entry.type);
    assert.match(entry.color, /^#[0-9a-fA-F]{6}$/, entry.type);
  }
});
