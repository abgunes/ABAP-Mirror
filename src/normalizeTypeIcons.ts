import { DEFAULT_TYPE_ICONS, TypeIconConfig } from './typeIconSvg';

const TYPE_RE = /^[A-Z0-9_]{1,20}$/;
const ABBREVIATION_RE = /^[A-Za-z0-9]{1,2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_ENTRIES = 100;

// The abapMirror.typeIcons value can come from two untrusted places: the
// user's settings.json (hand-edited) and the settings webview's postMessage
// payload. A TypeScript cast (message.rows as TypeIconConfig[]) checks nothing
// at runtime, so a stray quote in an abbreviation or a "red" instead of a hex
// color would flow into SVG generation and cache filenames. This normalizer is
// the single runtime boundary: anything that does not match the strict shape is
// dropped, and an UNKNOWN fallback is always guaranteed so the resolver can
// still resolve every object. The final array never exceeds MAX_ENTRIES,
// including the appended UNKNOWN fallback, so one slot is reserved for it when
// the input does not already carry an UNKNOWN row.
export function normalizeTypeIcons(input: unknown): TypeIconConfig[] {
  if (!Array.isArray(input)) return DEFAULT_TYPE_ICONS;

  const seen = new Set<string>();
  const out: TypeIconConfig[] = [];

  for (const raw of input.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    const typeValue = candidate.type;
    const abbreviationValue = candidate.abbreviation;
    const colorValue = candidate.color;
    if (typeof typeValue !== 'string' || typeof abbreviationValue !== 'string' || typeof colorValue !== 'string') {
      continue;
    }
    const type = typeValue.trim().toUpperCase();
    const abbreviation = abbreviationValue.trim();
    const color = colorValue.trim();
    if (!TYPE_RE.test(type) || !ABBREVIATION_RE.test(abbreviation) || !COLOR_RE.test(color)) {
      continue;
    }
    if (seen.has(type)) continue;
    seen.add(type);
    out.push({ type, abbreviation, color });
  }

  const hasUnknown = seen.has('UNKNOWN');
  // Reserve one slot for the appended UNKNOWN fallback so the returned array
  // stays capped at MAX_ENTRIES even when the input already fills the cap.
  const limit = hasUnknown ? MAX_ENTRIES : MAX_ENTRIES - 1;
  const capped = out.length > limit ? out.slice(0, limit) : out;

  if (!hasUnknown) {
    const fallback = DEFAULT_TYPE_ICONS.find(e => e.type === 'UNKNOWN');
    if (fallback) capped.push(fallback);
  }

  return capped;
}
