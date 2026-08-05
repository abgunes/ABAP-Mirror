// test/abapObjectType.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAbapObjectType } = require('../out/abapObjectType');

test('detects a class from an oo/classes path', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'oo', 'classes', 'zcl_foo', 'source', 'main']), 'CLAS');
});

test('detects an interface from an oo/interfaces path', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'oo', 'interfaces', 'zif_foo', 'source', 'main']), 'INTF');
});

test('detects a function module even though its path also contains the function group segment', () => {
  assert.equal(
    detectAbapObjectType(['sap', 'bc', 'adt', 'functions', 'groups', 'zfg', 'fmodules', 'z_fm', 'source', 'main']),
    'FUNC'
  );
});

test('detects a function group when there is no fmodules segment', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'functions', 'groups', 'zfg']), 'FUGR');
});

test('detects an include even though its path also contains the programs segment', () => {
  assert.equal(
    detectAbapObjectType(['sap', 'bc', 'adt', 'programs', 'includes', 'zincl', 'source', 'main']),
    'INCL'
  );
});

test('detects a program when there is no includes segment', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'programs', 'programs', 'zprog', 'source', 'main']), 'PROG');
});

test('detects a CDS data definition', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'ddic', 'ddl', 'sources', 'zi_foo', 'source', 'main']), 'DDLS');
});

test('detects a CDS metadata extension', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'ddic', 'metadataextensions', 'zi_foo_x']), 'DDLX');
});

test('detects a CDS access control', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'acm', 'accesscontrols', 'zi_foo_dcl']), 'DCLS');
});

test('detects a service definition', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'businessservices', 'servicedefinitions', 'zi_foo_sd']), 'SRVD');
});

test('detects a behavior definition', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'bo', 'behaviordefinitions', 'zi_foo']), 'BDEF');
});

test('detects a service binding', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'businessservices', 'servicebindings', 'zi_foo_sb']), 'SRVB');
});

test('detects a database table', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'ddic', 'tables', 'ztable']), 'TABL');
});

test('detects a structure', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'ddic', 'structures', 'zstruct']), 'STRU');
});

test('detects a table type', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'ddic', 'tabletypes', 'zttyp']), 'TTYP');
});

test('detects a data element', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'ddic', 'dataelements', 'zdtel']), 'DTEL');
});

test('detects a domain', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'ddic', 'domains', 'zdoma']), 'DOMA');
});

test('falls back to UNKNOWN for an unrecognized path', () => {
  assert.equal(detectAbapObjectType(['sap', 'bc', 'adt', 'wdy', 'applications', 'zwda']), 'UNKNOWN');
});

test('matching is case-insensitive on path segments', () => {
  assert.equal(detectAbapObjectType(['SAP', 'BC', 'ADT', 'OO', 'CLASSES', 'ZCL_FOO']), 'CLAS');
});
