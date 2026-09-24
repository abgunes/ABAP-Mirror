import { SourcePart } from './types';

// Pure helpers for SAP ADT abap:// URIs in vscode.Uri.toString() form, e.g.
// abap:/repotree-v1/<DESTINATION>/System%20Library/ZDEMO/Source%20Code%20Library/Classes/ZCL_DEMO_JOB/zcl_demo_job.clas.abap
// Leaf files follow the abapGit-style convention <name>.<type>[.<part>].<ext>.

export function isAbapUri(uri: string): boolean {
  return /^abap:/i.test(uri);
}

/** Decoded path segments after the scheme, empty segments dropped. */
export function pathSegments(uri: string): string[] {
  const withoutScheme = uri.replace(/^abap:/i, '');
  const withoutQuery = withoutScheme.split(/[?#]/)[0];
  return withoutQuery
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/** Destination (SAP system id) of a repotree URI: the segment after "repotree-v1". */
export function destinationOf(uri: string): string | undefined {
  if (!isAbapUri(uri)) return undefined;
  const segments = pathSegments(uri);
  return segments.length >= 2 ? segments[1] : undefined;
}

export function lastSegment(uri: string): string {
  const segments = pathSegments(uri);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

/** Parent URI, cut on the raw string so the original percent-encoding is kept. */
export function parentUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  return cut > trimmed.indexOf(':') + 1 ? trimmed.slice(0, cut) : trimmed;
}

export interface FileClassification {
  name: string; // upper case, e.g. ZCL_DEMO_JOB
  type: string; // upper case, e.g. CLAS
  part: SourcePart;
  isMetadata: boolean; // .json / .xml companion files, not source
}

const METADATA_EXTENSIONS = new Set(['json', 'xml']);

const PART_BY_MIDDLE: Record<string, SourcePart> = {
  definitions: 'definitions',
  locals_def: 'definitions',
  implementations: 'implementations',
  locals_imp: 'implementations',
  macros: 'macros',
  testclasses: 'testclasses',
};

export function classifyFile(fileName: string): FileClassification | undefined {
  const pieces = fileName.split('.');
  if (pieces.length < 3 || pieces.some((p) => p.length === 0)) return undefined;
  const type = pieces[1].toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(type)) return undefined;
  const extension = pieces[pieces.length - 1].toLowerCase();
  const middle = pieces.slice(2, -1).join('.').toLowerCase();
  const part: SourcePart = middle === '' ? 'main' : PART_BY_MIDDLE[middle] ?? 'other';
  return { name: pieces[0].toUpperCase(), type, part, isMetadata: METADATA_EXTENSIONS.has(extension) };
}
