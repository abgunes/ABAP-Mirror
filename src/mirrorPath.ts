// abap:// path segments become real folder and file names under the mirror
// root in the user's home directory, so each segment must be defended fully,
// not just against a few characters. Real ADT segments observed in the wild
// include runs of internal spaces (SICF-TYP object ids) and mixed case, and
// Windows silently strips trailing dots and spaces and reserves device names
// like CON and COM1. Any of those would make the path we write differ from the
// path we later compare against, breaking sync, or in the worst case escape the
// mirror root. This keeps segments stable, unique enough, and contained.
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

export function safeSegment(segment: string): string {
  // Replace characters that are invalid in a filename on Windows (and the path
  // separators), but leave internal spaces alone: they occur in real object
  // ids and only trailing spaces are dangerous, handled separately below.
  let s = segment.replace(/[<>:"|?*\\/]/g, '_');

  if (s === '.') s = '_';
  else if (s === '..') s = '__';

  // Replace any trailing dot/space run with the same number of underscores, so
  // nothing is stripped by the OS yet length and uniqueness are preserved.
  s = s.replace(/[ .]+$/g, run => '_'.repeat(run.length));

  const base = s.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED.has(base)) s = '_' + s;

  if (s.length === 0) s = '_';
  return s;
}
