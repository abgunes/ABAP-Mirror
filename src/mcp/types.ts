// Contracts between the MCP tools and the VS Code / SAP ADT world.
// Everything in src/mcp except adtBridge.ts, confirm.ts and lifecycle.ts
// depends only on these interfaces, so it runs under plain `node --test`.

export type SourcePart = 'main' | 'definitions' | 'implementations' | 'macros' | 'testclasses' | 'other';

export interface SystemInfo {
  destination: string;
  rootUri: string;
}

export interface DirEntry {
  name: string;
  kind: 'folder' | 'file';
  uri: string;
}

export interface DiagnosticInfo {
  severity: 'error' | 'warning' | 'info' | 'hint';
  line: number; // 1-based
  message: string;
}

export interface ReferenceLocation {
  uri: string;
  line: number; // 1-based
  snippet: string;
}

export interface IndexEntry {
  name: string;
  type: string;
  package: string;
  uri: string; // object folder URI
}

export interface AdtBridge {
  listSystems(): Promise<SystemInfo[]>;
  readDirectory(uri: string): Promise<DirEntry[]>;
  readFile(uri: string): Promise<string>;
  /** Replaces the whole document and saves it. Throws StaleSourceError if the open document no longer matches baseHash. */
  writeSource(uri: string, source: string, baseHash: string): Promise<{ newHash: string }>;
  activate(uri: string): Promise<void>;
  lock(uri: string): Promise<'locked' | 'unknown'>;
  unlock(uri: string): Promise<'unlocked' | 'unknown'>;
  diagnostics(uri: string): Promise<DiagnosticInfo[]>;
  /** line and character are 0-based, as in VS Code positions. */
  references(uri: string, line: number, character: number): Promise<ReferenceLocation[]>;
  /** Opens SAP's Open Object dialog and resolves with the URI of the document the user opened, or undefined. */
  pickObjectInteractively(destination: string, query: string): Promise<string | undefined>;
}

export type ConfirmAction = 'write' | 'write_activate' | 'activate' | 'lock' | 'unlock';

export interface ConfirmRequest {
  action: ConfirmAction;
  objectLabel: string;
  destination: string;
  uri: string;
  currentSource?: string;
  proposedSource?: string;
}

export interface Confirmer {
  confirm(request: ConfirmRequest): Promise<boolean>;
}

/** An error whose message is safe and useful to show to the MCP client as is. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export class StaleSourceError extends ToolError {
  constructor() {
    super('Source changed since you read it. Re-read it with abap_read_object and retry with the new hash.');
    this.name = 'StaleSourceError';
  }
}

export class NotFoundError extends ToolError {
  constructor(uri: string) {
    super(`Not found: ${uri}`);
    this.name = 'NotFoundError';
  }
}

export class TimeoutError extends ToolError {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)} s waiting for VS Code/SAP.`);
    this.name = 'TimeoutError';
  }
}

export const NOT_CONNECTED_MESSAGE =
  'No ABAP system connected in VS Code. Connect one with the SAP ADT extension (sapse.adt-vscode) first.';
