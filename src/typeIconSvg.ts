export interface TypeIconConfig {
  type: string;
  abbreviation: string;
  color: string;
}

// Ships as the default value of the abapMirror.typeIcons setting. Colors and
// groupings match the ones worked out in design discussion: class-related
// green, CDS-related blue, behavior-related purple, table-related (DDIC)
// yellow/gold, program-related brown, and a gray fallback for anything not
// in this table. A RAP behavior-implementation class has object type CLAS
// (SAP's own docs: no distinct object type exists for it), so it is NOT
// listed here separately: it renders with the CLAS entry like any class.
export const DEFAULT_TYPE_ICONS: TypeIconConfig[] = [
  { type: 'CLAS', abbreviation: 'CL', color: '#2ea043' },
  { type: 'INTF', abbreviation: 'IN', color: '#2ea043' },
  { type: 'DDLS', abbreviation: 'D', color: '#2f81f7' },
  { type: 'DDLX', abbreviation: 'MX', color: '#2f81f7' },
  { type: 'DCLS', abbreviation: 'AC', color: '#2f81f7' },
  { type: 'SRVD', abbreviation: 'SD', color: '#2f81f7' },
  { type: 'BDEF', abbreviation: 'BD', color: '#8957e5' },
  { type: 'SRVB', abbreviation: 'SB', color: '#8957e5' },
  { type: 'TABL', abbreviation: 'TB', color: '#c9a227' },
  { type: 'STRU', abbreviation: 'ST', color: '#c9a227' },
  { type: 'TTYP', abbreviation: 'TT', color: '#c9a227' },
  { type: 'DTEL', abbreviation: 'DE', color: '#c9a227' },
  { type: 'DOMA', abbreviation: 'DO', color: '#c9a227' },
  { type: 'PROG', abbreviation: 'P', color: '#a1682a' },
  { type: 'FUGR', abbreviation: 'FG', color: '#a1682a' },
  { type: 'INCL', abbreviation: 'I', color: '#a1682a' },
  { type: 'FUNC', abbreviation: 'FM', color: '#a1682a' },
  { type: 'UNKNOWN', abbreviation: '?', color: '#6e7681' },
];

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderTypeIconSvg(
  abbreviation: string,
  colorHex: string,
  options: { dirty?: boolean } = {}
): string {
  const label = escapeXmlText(abbreviation.slice(0, 2).toUpperCase());

  if (!options.dirty) {
    const fontSize = label.length > 1 ? 7 : 9;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
      `<rect width="16" height="16" rx="4" fill="${colorHex}"/>` +
      `<text x="8" y="8" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" ` +
      `font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>` +
      `</svg>`
    );
  }

  // Dirty variant: the type icon itself is drawn smaller and centered, with a
  // red box drawn around it in the extra margin. The border never overlaps
  // the abbreviation text, since it sits entirely outside the colored square.
  const fontSize = label.length > 1 ? 6 : 8;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">` +
    `<rect x="0.75" y="0.75" width="16.5" height="16.5" rx="5" fill="none" stroke="#f14c4c" stroke-width="1.5"/>` +
    `<rect x="3" y="3" width="12" height="12" rx="3" fill="${colorHex}"/>` +
    `<text x="9" y="9" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>` +
    `</svg>`
  );
}
