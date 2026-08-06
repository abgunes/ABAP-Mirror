const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTypeIcons } = require('../out/normalizeTypeIcons');
const { DEFAULT_TYPE_ICONS } = require('../out/typeIconSvg');

test('returns the defaults when input is not an array', () => {
  assert.deepEqual(normalizeTypeIcons(undefined), DEFAULT_TYPE_ICONS);
  assert.deepEqual(normalizeTypeIcons(null), DEFAULT_TYPE_ICONS);
  assert.deepEqual(normalizeTypeIcons('nope'), DEFAULT_TYPE_ICONS);
  assert.deepEqual(normalizeTypeIcons({}), DEFAULT_TYPE_ICONS);
});

test('keeps a valid entry and uppercases the type code', () => {
  const result = normalizeTypeIcons([{ type: 'clas', abbreviation: 'CL', color: '#2ea043' }]);
  const clas = result.find(e => e.type === 'CLAS');
  assert.deepEqual(clas, { type: 'CLAS', abbreviation: 'CL', color: '#2ea043' });
});

test('drops entries with a non-hex or shorthand color', () => {
  const result = normalizeTypeIcons([
    { type: 'CLAS', abbreviation: 'CL', color: 'red' },
    { type: 'INTF', abbreviation: 'IN', color: '#fff' },
    { type: 'DDLS', abbreviation: 'D', color: '#2f81f7' },
  ]);
  assert.equal(result.find(e => e.type === 'CLAS'), undefined);
  assert.equal(result.find(e => e.type === 'INTF'), undefined);
  assert.ok(result.find(e => e.type === 'DDLS'));
});

test('drops entries whose fields are the wrong shape', () => {
  const result = normalizeTypeIcons([
    { type: 123, abbreviation: 'CL', color: '#2ea043' },
    { type: 'DD LS', abbreviation: 'D', color: '#2f81f7' },
    { type: 'PROG', abbreviation: 'PROG', color: '#a1682a' },
    'not-an-object',
  ]);
  assert.equal(result.find(e => e.type === 'PROG'), undefined);
  assert.equal(result.length, 1); // only the appended UNKNOWN fallback survives
  assert.equal(result[0].type, 'UNKNOWN');
});

test('rejects XML-significant characters in the abbreviation', () => {
  const result = normalizeTypeIcons([{ type: 'CLAS', abbreviation: '<', color: '#2ea043' }]);
  assert.equal(result.find(e => e.type === 'CLAS'), undefined);
});

test('deduplicates by type keeping the first occurrence', () => {
  const result = normalizeTypeIcons([
    { type: 'CLAS', abbreviation: 'CL', color: '#2ea043' },
    { type: 'CLAS', abbreviation: 'XX', color: '#000000' },
  ]);
  const matches = result.filter(e => e.type === 'CLAS');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].abbreviation, 'CL');
});

test('always appends an UNKNOWN fallback when the input omits it', () => {
  const result = normalizeTypeIcons([{ type: 'CLAS', abbreviation: 'CL', color: '#2ea043' }]);
  const unknown = result.find(e => e.type === 'UNKNOWN');
  assert.ok(unknown);
  assert.match(unknown.color, /^#[0-9a-fA-F]{6}$/);
});

test('caps the number of entries at 100', () => {
  const many = Array.from({ length: 250 }, (_, i) => ({
    type: 'T' + i, abbreviation: 'X', color: '#123456',
  }));
  const result = normalizeTypeIcons(many);
  assert.ok(result.length <= 100);
});
