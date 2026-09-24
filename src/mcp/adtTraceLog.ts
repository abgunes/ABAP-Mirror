import * as path from 'node:path';
import { readTail } from './adtLog';

// A failed lock is not written to ADT's Eclipse log (./adtLog). SAP's reason
// only comes back in the language server's reply to the lock request, which
// ADT's own lockFile command ignores:
//
//   2026-01-31 23:16:18.545 [trace] Received response 'adtLs/fileSystem/lockFile - (349)' in 81ms.
//   Result: {
//       "lockingSupported": true,
//       "operationExecuted": true,
//       "errorMessage": "User X is currently editing Y"
//   }
//
// VS Code writes that reply to ADT's "ADT Error Log" output channel file, but
// only when the user turned tracing on ("adtLanguageClient.trace.server":
// "verbose" and log level Trace for that channel). Without tracing the file
// has no such lines and callers fall back to "unknown".

const ADT_EXTENSION_FOLDER = 'SAPSE.adt-vscode';
const TRACE_LOG_FILE = 'ADT Error Log.log';
// Verbose tracing logs whole directory listings, so read more than ./adtLog.
const TAIL_BYTES = 512 * 1024;
const RESPONSE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) \[trace\] Received response 'adtLs\/fileSystem\/(\w+) - \(\d+\)'/;

export type LockMethod = 'lockFile' | 'unlockFile';

export interface LockReply {
  lockingSupported?: boolean;
  operationExecuted?: boolean;
  errorMessage?: string;
}

export interface AdtTraceReader {
  // The last reply to `method` traced at or after sinceMs, polled for up to
  // waitMs; undefined when tracing is off or nothing arrived in time.
  lockReplySince(method: LockMethod, sinceMs: number, waitMs: number): Promise<LockReply | undefined>;
}

// Our log folder is <logs>/<window>/exthost/abgunes.abap-mirror; ADT's output
// channels are in <logs>/<window>/exthost/SAPSE.adt-vscode.
export function adtTraceLogPathFor(ownLogPath: string): string {
  return path.join(path.dirname(ownLogPath), ADT_EXTENSION_FOLDER, TRACE_LOG_FILE);
}

export function parseLockReply(text: string, method: LockMethod, sinceMs: number): LockReply | undefined {
  const lines = text.split(/\r?\n/);
  let reply: LockReply | undefined;
  for (let i = 0; i < lines.length; i++) {
    const response = RESPONSE_PATTERN.exec(lines[i]);
    if (!response || response[8] !== method) continue;
    const [year, month, day, hour, minute, second, ms] = response.slice(1, 8).map(Number);
    if (new Date(year, month - 1, day, hour, minute, second, ms).getTime() < sinceMs) continue;
    // "messages" tracing logs the response line without its Result block.
    if (lines[i + 1] !== 'Result: {') continue;
    const end = lines.indexOf('}', i + 2);
    if (end < 0) continue;
    try {
      const json: unknown = JSON.parse(['{', ...lines.slice(i + 2, end), '}'].join('\n'));
      if (json && typeof json === 'object') {
        const { lockingSupported, operationExecuted, errorMessage } = json as Record<string, unknown>;
        reply = {};
        if (typeof lockingSupported === 'boolean') reply.lockingSupported = lockingSupported;
        if (typeof operationExecuted === 'boolean') reply.operationExecuted = operationExecuted;
        if (typeof errorMessage === 'string' && errorMessage.trim()) reply.errorMessage = errorMessage.trim();
      }
    } catch {
      // cut or malformed block: ignore it
    }
    i = end;
  }
  return reply;
}

export function createAdtTraceReader(logPath: string | undefined, pollMs = 150): AdtTraceReader {
  return {
    async lockReplySince(method: LockMethod, sinceMs: number, waitMs: number): Promise<LockReply | undefined> {
      if (!logPath) return undefined;
      const deadline = Date.now() + waitMs;
      for (;;) {
        try {
          const text = await readTail(logPath, TAIL_BYTES);
          // No trace lines at all: tracing is off, so no reply will ever show up.
          if (!text.includes(' [trace] ')) return undefined;
          const reply = parseLockReply(text, method, sinceMs);
          if (reply) return reply;
        } catch {
          // no trace file: tracing was never turned on in this window
        }
        if (Date.now() >= deadline) return undefined;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
  };
}
