// Finds where an object's own name is declared in its main source, so
// VS Code's reference provider (backed by SAP where-used) can be asked about it.

export interface SourcePosition {
  line: number; // 0-based
  character: number; // 0-based
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Most specific first; the last pattern is the whole-word fallback.
function declarationPatterns(name: string): RegExp[] {
  const n = escapeRegExp(name);
  return [
    new RegExp(`\\bclass\\s+(${n})\\s+definition\\b`, 'di'),
    new RegExp(`\\binterface\\s+(${n})\\b`, 'di'),
    new RegExp(`\\bfunction\\s+(${n})\\b`, 'di'),
    new RegExp(`\\b(?:report|program)\\s+(${n})\\b`, 'di'),
    new RegExp(`\\bdefine\\s+(?:root\\s+)?view\\s+(?:entity\\s+)?(${n})\\b`, 'di'),
    new RegExp(`\\bdefine\\s+(?:abstract\\s+|custom\\s+)?entity\\s+(${n})\\b`, 'di'),
    new RegExp(`\\bdefine\\s+(?:table|structure|service|type)\\s+(${n})\\b`, 'di'),
    new RegExp(`(?:^|[^A-Za-z0-9_/])(${n})(?![A-Za-z0-9_])`, 'di'),
  ];
}

export function findIdentifierPosition(source: string, name: string): SourcePosition | undefined {
  const lines = source.split(/\r?\n/);
  for (const pattern of declarationPatterns(name)) {
    for (let i = 0; i < lines.length; i++) {
      const match = pattern.exec(lines[i]);
      if (match && match.indices && match.indices[1]) {
        return { line: i, character: match.indices[1][0] };
      }
    }
  }
  return undefined;
}
