// Rough "+added/-removed lines" figure for the confirmation popup. Counts
// lines as a multiset, so moved lines count as unchanged; good enough for a
// human to judge the size of a change before opening the real diff.

export interface LineChangeSummary {
  added: number;
  removed: number;
}

function countLines(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

export function summarizeLineChanges(before: string, after: string): LineChangeSummary {
  const oldCounts = countLines(before);
  const newCounts = countLines(after);
  let added = 0;
  let removed = 0;
  for (const [line, n] of newCounts) added += Math.max(0, n - (oldCounts.get(line) ?? 0));
  for (const [line, n] of oldCounts) removed += Math.max(0, n - (newCounts.get(line) ?? 0));
  return { added, removed };
}
