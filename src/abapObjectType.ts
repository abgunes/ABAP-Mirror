export type AbapObjectTypeCode =
  | 'CLAS'
  | 'INTF'
  | 'DDLS'
  | 'DDLX'
  | 'DCLS'
  | 'SRVD'
  | 'BDEF'
  | 'SRVB'
  | 'TABL'
  | 'STRU'
  | 'TTYP'
  | 'DTEL'
  | 'DOMA'
  | 'PROG'
  | 'FUGR'
  | 'INCL'
  | 'FUNC'
  | 'UNKNOWN';

// ADT's abap:// URIs render as a friendly package/repository-browser
// hierarchy (package names, "Classes"/"Source Code Library"-style grouping
// folders, then the object itself), not SAP's REST API resource paths. The
// object's type instead lives as an abapGit-style dotted suffix on the
// leaf segment itself, e.g. "zcl_foo.clas.abap", "zi_foo.ddls.acds",
// "zi_foo.ddls.json". A class's mirror can have several leaves
// (.clas.abap, .clas.definitions.abap, .clas.implementations.abap,
// .clas.json) that all carry the same "clas" token, and a CDS view's two
// leaves (.ddls.acds source, .ddls.json metadata) both carry "ddls".
//
// CLAS and DDLS are confirmed against a live ADT connection (see the mirror
// leaf filenames this was built from: zagr_cl_disp_pln_brd.clas.abap,
// zagr_i_disp_pln_brd_orders.ddls.acds/.ddls.json). The remaining entries
// follow the same well-documented, stable abapGit suffix convention but
// have not each been individually confirmed live. An unrecognized suffix
// safely falls back to UNKNOWN rather than guessing.
//
// Structures share the same "tabl" suffix as database tables in this
// convention (SAP's own object-type list files both under object type
// TABL, distinguished only by a DTAB/STRU sub-kind that isn't visible in
// the filename), so a bare ".tabl." leaf always resolves to TABL, never
// STRU, by design.
const SUFFIX_TYPE_MAP: Record<string, AbapObjectTypeCode> = {
  clas: 'CLAS',
  intf: 'INTF',
  ddls: 'DDLS',
  ddlx: 'DDLX',
  dcls: 'DCLS',
  srvd: 'SRVD',
  bdef: 'BDEF',
  srvb: 'SRVB',
  tabl: 'TABL',
  ttyp: 'TTYP',
  dtel: 'DTEL',
  doma: 'DOMA',
  prog: 'PROG',
  fugr: 'FUGR',
  func: 'FUNC',
};

export function detectAbapObjectType(pathSegments: string[]): AbapObjectTypeCode {
  if (pathSegments.length === 0) return 'UNKNOWN';
  const leaf = pathSegments[pathSegments.length - 1].toLowerCase();
  for (const token of leaf.split('.')) {
    const type = SUFFIX_TYPE_MAP[token];
    if (type) return type;
  }
  return 'UNKNOWN';
}
