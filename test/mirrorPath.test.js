const test = require('node:test');
const assert = require('node:assert/strict');
const { safeSegment } = require('../out/mirrorPath');

test('leaves an ordinary segment unchanged', () => {
  assert.equal(safeSegment('ZAGR_CL_DISP_PLN_BRD'), 'ZAGR_CL_DISP_PLN_BRD');
});

test('replaces Windows-invalid characters with underscore', () => {
  assert.equal(safeSegment('a<b>c:d"e|f?g*h'), 'a_b_c_d_e_f_g_h');
});

test('maps dot and dot-dot segments so they cannot traverse', () => {
  assert.equal(safeSegment('.'), '_');
  assert.equal(safeSegment('..'), '__');
});

test('removes trailing dots and spaces that Windows would silently strip', () => {
  assert.doesNotMatch(safeSegment('name.'), /[ .]$/);
  assert.doesNotMatch(safeSegment('name   '), /[ .]$/);
  // internal spaces are preserved (seen in real SICF-TYP object ids)
  assert.equal(safeSegment('ZDISPO  ABC'), 'ZDISPO  ABC');
});

test('escapes Windows reserved device names case-insensitively', () => {
  assert.equal(safeSegment('CON'), '_CON');
  assert.equal(safeSegment('nul'), '_nul');
  assert.equal(safeSegment('COM1'), '_COM1');
  assert.equal(safeSegment('LPT9.txt'), '_LPT9.txt');
});

test('never returns an empty string', () => {
  assert.notEqual(safeSegment(''), '');
  assert.notEqual(safeSegment('   '), '');
});

test('does not treat a name that merely contains a reserved word as reserved', () => {
  assert.equal(safeSegment('CONTROLLER'), 'CONTROLLER');
});
