const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAbapUri,
  pathSegments,
  destinationOf,
  lastSegment,
  parentUri,
  classifyFile,
} = require('../out/mcp/abapUri');

const FILE = 'abap:/repotree-v1/DEV_SYS/System%20Library/ZDEMO/Source%20Code%20Library/Classes/ZCL_DEMO_JOB/zcl_demo_job.clas.abap';

test('isAbapUri accepts only the abap scheme', () => {
  assert.equal(isAbapUri(FILE), true);
  assert.equal(isAbapUri('ABAP:/repotree-v1/X'), true);
  assert.equal(isAbapUri('file:///c:/x.abap'), false);
});

test('pathSegments decodes percent-encoding and drops empty segments', () => {
  assert.deepEqual(pathSegments('abap:/repotree-v1/DEV_SYS/System%20Library/'), [
    'repotree-v1',
    'DEV_SYS',
    'System Library',
  ]);
});

test('pathSegments keeps a segment with a broken escape as is', () => {
  assert.deepEqual(pathSegments('abap:/repotree-v1/A%ZZ'), ['repotree-v1', 'A%ZZ']);
});

test('destinationOf returns the segment after repotree-v1', () => {
  assert.equal(destinationOf(FILE), 'DEV_SYS');
  assert.equal(destinationOf('abap:/repotree-v1'), undefined);
  assert.equal(destinationOf('file:///x'), undefined);
});

test('lastSegment and parentUri keep the raw encoding', () => {
  assert.equal(lastSegment(FILE), 'zcl_demo_job.clas.abap');
  assert.equal(
    parentUri(FILE),
    'abap:/repotree-v1/DEV_SYS/System%20Library/ZDEMO/Source%20Code%20Library/Classes/ZCL_DEMO_JOB'
  );
  assert.equal(parentUri('abap:/repotree-v1/DEV_SYS/'), 'abap:/repotree-v1');
});

test('classifyFile reads name, type and main part', () => {
  assert.deepEqual(classifyFile('zcl_demo_job.clas.abap'), {
    name: 'ZCL_DEMO_JOB',
    type: 'CLAS',
    part: 'main',
    isMetadata: false,
  });
});

test('classifyFile maps class include suffixes to parts', () => {
  assert.equal(classifyFile('zcl_x.clas.definitions.abap').part, 'definitions');
  assert.equal(classifyFile('zcl_x.clas.locals_def.abap').part, 'definitions');
  assert.equal(classifyFile('zcl_x.clas.implementations.abap').part, 'implementations');
  assert.equal(classifyFile('zcl_x.clas.locals_imp.abap').part, 'implementations');
  assert.equal(classifyFile('zcl_x.clas.macros.abap').part, 'macros');
  assert.equal(classifyFile('zcl_x.clas.testclasses.abap').part, 'testclasses');
  assert.equal(classifyFile('zcl_x.clas.something_new.abap').part, 'other');
});

test('classifyFile flags json and xml companions as metadata', () => {
  assert.equal(classifyFile('zcl_x.clas.json').isMetadata, true);
  assert.equal(classifyFile('zfg.fugr.xml').isMetadata, true);
  assert.equal(classifyFile('zi_view.ddls.acds').isMetadata, false);
  assert.equal(classifyFile('zi_view.ddls.acds').type, 'DDLS');
});

test('classifyFile rejects names that are not name.type.ext', () => {
  assert.equal(classifyFile('README'), undefined);
  assert.equal(classifyFile('notes.txt'), undefined);
  assert.equal(classifyFile('a..abap'), undefined);
  assert.equal(classifyFile('x.c-l.abap'), undefined);
});
