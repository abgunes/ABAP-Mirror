// test/abapObjectType.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAbapObjectType } = require('../out/abapObjectType');

// These first two cases are the exact, real abap:// path segments observed
// from a live ADT connection (reconstructed from the on-disk mirror folder
// tree, which is a 1:1 rendering of the URI's path segments). They are the
// evidence this detector is built against, not synthetic guesses.

test('detects a CDS view from its real dotted leaf suffix (.ddls.acds)', () => {
  assert.equal(
    detectAbapObjectType([
      'It_Agri_S23_S4H_100_AGUNES_EN',
      'System Library',
      'ZIT_AGRO',
      'ZIT_AGRO_DISPOSITION',
      'ZIT_AGRO_DISPOSITION_PLN_BRD',
      'ZAGR_I_DISP_PLN_BRD_ORDERS',
      'zagr_i_disp_pln_brd_orders.ddls.acds',
    ]),
    'DDLS'
  );
});

test('detects the same CDS view from its metadata leaf (.ddls.json)', () => {
  assert.equal(
    detectAbapObjectType([
      'It_Agri_S23_S4H_100_AGUNES_EN',
      'System Library',
      'ZIT_AGRO',
      'ZIT_AGRO_DISPOSITION',
      'ZIT_AGRO_DISPOSITION_PLN_BRD',
      'ZAGR_I_DISP_PLN_BRD_ORDERS',
      'zagr_i_disp_pln_brd_orders.ddls.json',
    ]),
    'DDLS'
  );
});

test('detects a class from its real dotted leaf suffix (.clas.abap), independent of any ancestor folder name', () => {
  assert.equal(
    detectAbapObjectType([
      'It_Agri_S23_S4H_100_AGUNES_EN',
      'System Library',
      'ZIT_AGRO',
      'ZIT_AGRO_DISPOSITION',
      'ZIT_AGRO_DISPOSITION_PLN_BRD',
      'Source Code Library',
      'Classes',
      'ZAGR_CL_DISP_PLN_BRD',
      'zagr_cl_disp_pln_brd.clas.abap',
    ]),
    'CLAS'
  );
});

test('detects a class from its definitions/implementations/json companion leaves the same way', () => {
  const base = [
    'ZAGR_AGRO',
    'Source Code Library',
    'Classes',
    'ZAGR_CL_DISP_PLN_BRD',
  ];
  assert.equal(detectAbapObjectType([...base, 'zagr_cl_disp_pln_brd.clas.definitions.abap']), 'CLAS');
  assert.equal(detectAbapObjectType([...base, 'zagr_cl_disp_pln_brd.clas.implementations.abap']), 'CLAS');
  assert.equal(detectAbapObjectType([...base, 'zagr_cl_disp_pln_brd.clas.json']), 'CLAS');
});

test('detects an interface from its dotted leaf suffix (.intf.abap)', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Interfaces', 'zif_disp.intf.abap']), 'INTF');
});

test('detects a behavior definition from its dotted leaf suffix (.bdef.asbdef)', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zagr_i_foo.bdef.asbdef']), 'BDEF');
});

test('detects a service binding from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zagr_ui_foo.srvb.assrvb']), 'SRVB');
});

test('detects a service definition from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zagr_i_foo_sd.srvd.assrvd']), 'SRVD');
});

test('detects a CDS metadata extension from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zagr_i_foo.ddlx.asddlx']), 'DDLX');
});

test('detects a CDS access control from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zagr_i_foo.dcls.asdcls']), 'DCLS');
});

test('detects a database table from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Dictionary', 'ztable.tabl.xml']), 'TABL');
});

test('detects a table type from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Dictionary', 'zttyp.ttyp.xml']), 'TTYP');
});

test('detects a data element from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Dictionary', 'zdtel.dtel.xml']), 'DTEL');
});

test('detects a domain from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Dictionary', 'zdoma.doma.xml']), 'DOMA');
});

test('detects a program from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Source Code Library', 'Programs', 'zprog.prog.abap']), 'PROG');
});

test('detects a function group from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Source Code Library', 'Function Groups', 'zfg.fugr.xml']), 'FUGR');
});

test('detects a function module from its dotted leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zfg.fugr', 'z_fm.func.abap']), 'FUNC');
});

test('falls back to UNKNOWN for a leaf with no recognized type token', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'Web Dynpro', 'zwda.wdya.xml']), 'UNKNOWN');
});

test('falls back to UNKNOWN for a leaf with no dot at all', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zsomefolder']), 'UNKNOWN');
});

test('falls back to UNKNOWN for an empty path', () => {
  assert.equal(detectAbapObjectType([]), 'UNKNOWN');
});

test('matching is case-insensitive on the leaf suffix', () => {
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'ZCL_FOO.CLAS.ABAP']), 'CLAS');
});

test('an object name that happens to contain a substring like "class" does not false-match without a dot boundary', () => {
  // "subclass" contains the letters "clas" but is not the dotted token "clas" itself.
  assert.equal(detectAbapObjectType(['ZAGR_AGRO', 'zsubclass_helper.prog.abap']), 'PROG');
});
