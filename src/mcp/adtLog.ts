import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// SAP's ADT extension shows the real reason a save or lock failed (for
// example "Object cannot be locked: User X is currently editing Y") only in
// its own notification, which another extension cannot observe. Its language
// server also writes the same text to its Eclipse workspace log, which lives
// next to our own workspace storage folder. Reading that file is the only way
// to hand SAP's exact words back to an MCP client. The format is Eclipse's:
//
//   !ENTRY com.sap.adt.ls 4 0 2026-01-31 23:16:18.545
//   !MESSAGE Object cannot be locked: ...
//
// where 4 is the ERROR severity and the timestamp is local time.

const ADT_EXTENSION_FOLDER = 'SAPSE.adt-vscode';
const TAIL_BYTES = 64 * 1024;
const ERROR_SEVERITY = 4;
const ENTRY_PATTERN = /^!ENTRY (com\.sap\.adt\S*) (\d+) \S+ (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*$/;
const MAX_MESSAGES = 3;

export interface AdtLogReader {
  // SAP error messages logged at or after sinceMs, polled for up to waitMs
  // because ADT writes the entry a few hundred milliseconds after the failure.
  errorsSince(sinceMs: number, waitMs: number): Promise<string[]>;
}

// Our storage folder is <workspaceStorage>/<hash>/abgunes.abap-mirror; ADT's
// Eclipse workspace is <workspaceStorage>/<hash>/SAPSE.adt-vscode/adtWorkspace.
export function adtLogPathFor(ownStoragePath: string): string {
  return path.join(path.dirname(ownStoragePath), ADT_EXTENSION_FOLDER, 'adtWorkspace', '.metadata', '.log');
}

export function parseAdtLogErrors(text: string, sinceMs: number): string[] {
  const messages: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const entry = ENTRY_PATTERN.exec(lines[i]);
    if (!entry || Number(entry[2]) < ERROR_SEVERITY) continue;
    const [year, month, day, hour, minute, second, ms] = entry.slice(3).map(Number);
    if (new Date(year, month - 1, day, hour, minute, second, ms).getTime() < sinceMs) continue;
    if (!lines[i + 1]?.startsWith('!MESSAGE ')) continue;
    const message = [lines[i + 1].slice('!MESSAGE '.length)];
    for (let j = i + 2; j < lines.length && lines[j] !== '' && !lines[j].startsWith('!'); j++) message.push(lines[j]);
    const joined = message.join(' ').trim();
    if (joined && !messages.includes(joined)) messages.push(joined);
  }
  return messages.slice(-MAX_MESSAGES);
}

export async function readTail(file: string, tailBytes = TAIL_BYTES): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    // Drop the first, probably cut, line when not reading from the start.
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
  } finally {
    await handle.close();
  }
}

export function createAdtLogReader(logPath: string | undefined, pollMs = 150): AdtLogReader {
  return {
    async errorsSince(sinceMs: number, waitMs: number): Promise<string[]> {
      if (!logPath) return [];
      const deadline = Date.now() + waitMs;
      for (;;) {
        try {
          const found = parseAdtLogErrors(await readTail(logPath), sinceMs);
          if (found.length > 0) return found;
        } catch {
          // no log (yet), or ADT is rotating it: try again until the deadline
        }
        if (Date.now() >= deadline) return [];
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
  };
}
