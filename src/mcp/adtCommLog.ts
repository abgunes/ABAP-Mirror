import * as path from 'node:path';
import { readTail } from './adtLog';

// ADT's lock and unlock commands report nothing back to their caller, and
// SAP's reason for a refused lock only reaches disk with tracing on (see
// ./adtTraceLog). What ADT always logs, at the default level, is every HTTP
// call it makes to SAP, in its "ADT Communication Log" output channel:
//
//   2026-01-31 23:16:18.249 [info] DEV_SYS   POST 403   102(   47|   55)ms   ../oo/classes/zcl_demo?_action=LOCK&accessMode=MODIFY
//
// so the status SAP gave the LOCK/UNLOCK call tells whether it worked.

const ADT_EXTENSION_FOLDER = 'SAPSE.adt-vscode';
const COMM_LOG_FILE = 'ADT Communication Log.log';
const LINE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) \[\w+\] (\S+)\s+POST\s+(\d{3})\s.*\/([^/?\s]+)\?(?:\S*&)?_action=(LOCK|UNLOCK)(?:&|\s*$)/;

export type LockAction = 'LOCK' | 'UNLOCK';

export interface AdtCommReader {
  // HTTP status of the first LOCK/UNLOCK call for objectName on `destination`
  // logged at or after sinceMs, polled for up to waitMs; undefined when none
  // showed up. Without objectName any object on that destination matches.
  lockStatusSince(
    action: LockAction,
    destination: string,
    objectName: string | undefined,
    sinceMs: number,
    waitMs: number
  ): Promise<number | undefined>;
}

// Our log folder is <logs>/<window>/exthost/abgunes.abap-mirror; ADT's output
// channels are in <logs>/<window>/exthost/SAPSE.adt-vscode.
export function adtCommLogPathFor(ownLogPath: string): string {
  return path.join(path.dirname(ownLogPath), ADT_EXTENSION_FOLDER, COMM_LOG_FILE);
}

// ZCL_DEMO, zcl_demo and, for namespaces, %2fabc%2fcl_demo (log) or
// #abc#cl_demo (file name) all compare equal.
function normalizeName(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // keep it as logged
  }
  return decoded.replace(/#/g, '/').toUpperCase();
}

export function parseLockStatus(
  text: string,
  action: LockAction,
  destination: string,
  objectName: string | undefined,
  sinceMs: number
): number | undefined {
  const wanted = objectName === undefined ? undefined : normalizeName(objectName);
  for (const line of text.split(/\r?\n/)) {
    const match = LINE_PATTERN.exec(line);
    if (!match || match[11] !== action || match[8].toUpperCase() !== destination.toUpperCase()) continue;
    if (wanted !== undefined && normalizeName(match[10]) !== wanted) continue;
    const [year, month, day, hour, minute, second, ms] = match.slice(1, 8).map(Number);
    if (new Date(year, month - 1, day, hour, minute, second, ms).getTime() < sinceMs) continue;
    return Number(match[9]);
  }
  return undefined;
}

export function createAdtCommReader(logPath: string | undefined, pollMs = 150): AdtCommReader {
  return {
    async lockStatusSince(action, destination, objectName, sinceMs, waitMs): Promise<number | undefined> {
      if (!logPath) return undefined;
      const deadline = Date.now() + waitMs;
      for (;;) {
        try {
          const status = parseLockStatus(await readTail(logPath), action, destination, objectName, sinceMs);
          if (status !== undefined) return status;
        } catch {
          // no log yet: ADT has not talked to SAP in this window
        }
        if (Date.now() >= deadline) return undefined;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
  };
}
