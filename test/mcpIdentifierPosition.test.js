const test = require('node:test');
const assert = require('node:assert/strict');
const { findIdentifierPosition } = require('../out/mcp/identifierPosition');

test('finds the class name in CLASS ... DEFINITION, not an earlier mention', () => {
  const source = '"! Uses zcl_demo_job internally\nCLASS zcl_demo_job DEFINITION PUBLIC.\nENDCLASS.';
  assert.deepEqual(findIdentifierPosition(source, 'ZCL_DEMO_JOB'), { line: 1, character: 6 });
});

test('finds an interface declaration', () => {
  assert.deepEqual(findIdentifierPosition('INTERFACE zif_demo PUBLIC.', 'ZIF_DEMO'), { line: 0, character: 10 });
});

test('finds a CDS view entity name', () => {
  const source = '@EndUserText.label: \'x\'\ndefine root view entity ZI_DEMO_VIEW as select from zdemo_tab';
  assert.deepEqual(findIdentifierPosition(source, 'ZI_DEMO_VIEW'), { line: 1, character: 24 });
});

test('finds a report name', () => {
  assert.deepEqual(findIdentifierPosition('REPORT zdemo_report.', 'ZDEMO_REPORT'), { line: 0, character: 7 });
});

test('falls back to the first whole-word occurrence', () => {
  const source = 'x = zdemo_thing_long.\ny = zdemo_thing.';
  assert.deepEqual(findIdentifierPosition(source, 'ZDEMO_THING'), { line: 1, character: 4 });
});

test('treats regex characters in the name literally', () => {
  assert.equal(findIdentifierPosition('CLASS zcl_x DEFINITION.', 'ZCL.X'), undefined);
});

test('returns undefined when the name does not occur', () => {
  assert.equal(findIdentifierPosition('CLASS zcl_other DEFINITION.', 'ZCL_DEMO_JOB'), undefined);
});
