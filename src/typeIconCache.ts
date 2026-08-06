import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderTypeIconSvg } from './typeIconSvg';

function iconFileName(abbreviation: string, colorHex: string, dirty: boolean): string {
  const safeAbbreviation = abbreviation.replace(/[^a-zA-Z0-9]/g, '') || 'unknown';
  const safeColor = colorHex.replace(/[^a-zA-Z0-9]/g, '');
  return `${safeAbbreviation}-${safeColor}${dirty ? '-dirty' : ''}.svg`;
}

export function getOrCreateIconFile(
  cacheDir: string,
  abbreviation: string,
  colorHex: string,
  dirty = false
): string {
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, iconFileName(abbreviation, colorHex, dirty));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, renderTypeIconSvg(abbreviation, colorHex, { dirty }), 'utf8');
  }
  return filePath;
}
