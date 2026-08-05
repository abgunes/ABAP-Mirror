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

interface DetectionRule {
  type: AbapObjectTypeCode;
  // every keyword must appear as its own path segment for the rule to match
  keywords: string[];
}

// Best-effort mapping from SAP ADT's REST resource path segments to ABAP
// object type codes (cross-checked against SAP's official ADT object-type
// list). ADT's abap:// URIs follow its REST API's resource paths (e.g.
// /sap/bc/adt/oo/classes/{name}/...), which is a more reliable signal than
// the mirror's on-disk leaf filename: sapse.adt-vscode collapses many
// distinct DDIC/source object types under the same .abap/.ddic/.acds file
// extensions, so the leaf name alone can't tell a class from a program, or
// a table from a domain.
//
// These keyword rules have NOT been verified against a live ADT connection.
// Rules are checked in order and the first full match wins, so more specific
// rules (e.g. FUNC, which also has the FUGR keywords as ancestors) are
// listed before their more general counterparts. If an object shows up as
// the gray "?" fallback when it shouldn't, inspect the mismatched abap://
// URI directly (e.g. via a debugger or a temporary log line in
// resolveObjectTypeForMirror in extension.ts) and correct the rule below
// to match what a real system actually returns.
const RULES: DetectionRule[] = [
  { type: 'FUNC', keywords: ['functions', 'fmodules'] },
  { type: 'FUGR', keywords: ['functions', 'groups'] },
  { type: 'INCL', keywords: ['includes'] },
  { type: 'PROG', keywords: ['programs'] },
  { type: 'INTF', keywords: ['interfaces'] },
  { type: 'CLAS', keywords: ['classes'] },
  { type: 'BDEF', keywords: ['behaviordefinitions'] },
  { type: 'SRVB', keywords: ['servicebindings'] },
  { type: 'SRVD', keywords: ['servicedefinitions'] },
  { type: 'DCLS', keywords: ['accesscontrols'] },
  { type: 'DDLX', keywords: ['metadataextensions'] },
  { type: 'DDLS', keywords: ['ddl', 'sources'] },
  { type: 'TTYP', keywords: ['tabletypes'] },
  { type: 'STRU', keywords: ['structures'] },
  { type: 'TABL', keywords: ['tables'] },
  { type: 'DTEL', keywords: ['dataelements'] },
  { type: 'DOMA', keywords: ['domains'] },
];

export function detectAbapObjectType(pathSegments: string[]): AbapObjectTypeCode {
  const lower = pathSegments.map(segment => segment.toLowerCase());
  for (const rule of RULES) {
    if (rule.keywords.every(keyword => lower.includes(keyword))) {
      return rule.type;
    }
  }
  return 'UNKNOWN';
}
