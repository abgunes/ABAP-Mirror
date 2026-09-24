import * as path from 'node:path';
import * as vscode from 'vscode';
import { classifyFile, destinationOf, lastSegment } from './abapUri';
import { AdtCommReader, createAdtCommReader } from './adtCommLog';
import { AdtLogReader, createAdtLogReader } from './adtLog';
import { AdtTraceReader, createAdtTraceReader, LockMethod } from './adtTraceLog';
import { sha256Hex } from './hash';
import {
  AdtBridge,
  DiagnosticInfo,
  DirEntry,
  GuardedCommand,
  NotFoundError,
  ReferenceLocation,
  StaleSourceError,
  SystemInfo,
  ToolError,
  UnsavedChangesError,
} from './types';

// The only place where the MCP module talks to VS Code and SAP's ADT
// extension (sapse.adt-vscode). Every SAP call rides on the session that
// extension already holds; abap-mirror never logs in on its own.

const ADT_EXTENSION_ID = 'sapse.adt-vscode';
const DIAGNOSTICS_WAIT_MS = 10_000;
const MAX_SNIPPET_FILES = 50;
// SAP's ADT extension reports the real reason a save/lock failed (for
// example another user holding the lock) only in its own notification, not
// through the promise we are awaiting, and VS Code does not let one extension
// observe another's notifications. A failed save lands in ADT's Eclipse log
// (./adtLog); a lock/unlock shows up in ADT's HTTP log (./adtCommLog) and,
// with tracing on, with SAP's text in its trace (./adtTraceLog). The hint
// below is the fallback when the logs have nothing.
const CHECK_NOTIFICATIONS_HINT = "check VS Code's Notifications (the bell icon) for SAP's exact reason";
// ADT writes its log entries a few hundred milliseconds after the call.
const SAP_REASON_WAIT_MS = 2_000;

function toUri(uri: string): vscode.Uri {
  return vscode.Uri.parse(uri, true);
}

function asToolError(error: unknown, uri: string): Error {
  if (error instanceof ToolError) return error;
  if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return new NotFoundError(uri);
  const message = error instanceof Error ? error.message : String(error);
  return new ToolError(`SAP ADT: ${message}`);
}

const SEVERITY: Record<number, DiagnosticInfo['severity']> = {
  [vscode.DiagnosticSeverity.Error]: 'error',
  [vscode.DiagnosticSeverity.Warning]: 'warning',
  [vscode.DiagnosticSeverity.Information]: 'info',
  [vscode.DiagnosticSeverity.Hint]: 'hint',
};

export function createAdtBridge(
  log: (line: string) => void,
  adtLog: AdtLogReader = createAdtLogReader(undefined),
  adtTrace: AdtTraceReader = createAdtTraceReader(undefined),
  adtComm: AdtCommReader = createAdtCommReader(undefined)
): AdtBridge & vscode.Disposable {
  // uri -> time of the last diagnostics change / of our last save or activation.
  const lastDiagnosticsChange = new Map<string, number>();
  const lastOperation = new Map<string, number>();
  const diagnosticsListener = vscode.languages.onDidChangeDiagnostics((event) => {
    const now = Date.now();
    for (const uri of event.uris) {
      if (uri.scheme === 'abap') lastDiagnosticsChange.set(uri.toString(), now);
    }
  });

  async function ensureAdt(): Promise<void> {
    const extension = vscode.extensions.getExtension(ADT_EXTENSION_ID);
    if (!extension) throw new ToolError(`SAP ADT extension (${ADT_EXTENSION_ID}) is not installed in VS Code.`);
    if (!extension.isActive) await extension.activate();
  }

  // SAP relates the editors of one object by folder (path.dirname of the
  // URI path) when deciding what its activate/lock/unlock commands touch.
  function unsavedRelated(uri: string): string[] {
    const folder = path.posix.dirname(toUri(uri).path);
    return vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === 'abap' && d.isDirty && path.posix.dirname(d.uri.path) === folder)
      .map((d) => d.uri.toString());
  }

  function assertNoUnsavedRelated(uri: string, command: GuardedCommand): void {
    const unsaved = unsavedRelated(uri);
    if (unsaved.length > 0) throw new UnsavedChangesError(command, unsaved);
  }

  // SAP's activate/lock/unlock commands take no arguments and act on the
  // active editor, so show the document, run the command, then give the
  // user their previous editor back.
  async function runOnActiveEditor(uri: string, command: string): Promise<void> {
    await ensureAdt();
    const previous = vscode.window.activeTextEditor;
    const document = await vscode.workspace.openTextDocument(toUri(uri));
    const targetUri = document.uri.toString();
    const isActive = (): boolean => vscode.window.activeTextEditor?.document.uri.toString() === targetUri;
    await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
    try {
      if (!isActive()) {
        // Something else (for example the mirror feature's own focus change) stole
        // the active editor; try once more before giving up.
        await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
      }
      if (!isActive()) {
        throw new ToolError(`Could not make ${uri} the active editor, so ${command} was not run.`);
      }
      await vscode.commands.executeCommand(command);
    } finally {
      if (previous && previous.document.uri.toString() !== targetUri) {
        await vscode.window.showTextDocument(previous.document, { viewColumn: previous.viewColumn, preserveFocus: false });
      }
    }
  }

  async function revertDocument(document: vscode.TextDocument): Promise<void> {
    const previous = vscode.window.activeTextEditor;
    await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
    await vscode.commands.executeCommand('workbench.action.files.revert');
    if (previous && previous.document.uri.toString() !== document.uri.toString()) {
      await vscode.window.showTextDocument(previous.document, { viewColumn: previous.viewColumn });
    }
  }

  // Quote SAP's own error text when ADT logged one since `since`; otherwise
  // fall back to our guess plus a pointer to VS Code's notifications.
  async function failureWithSapReason(summary: string, since: number, fallbackDetail: string): Promise<ToolError> {
    const reasons = await adtLog.errorsSince(since, SAP_REASON_WAIT_MS);
    if (reasons.length > 0) return new ToolError(`${summary} SAP says: ${reasons.join(' | ')}`);
    return new ToolError(`${summary} ${fallbackDetail}; ${CHECK_NOTIFICATIONS_HINT}.`);
  }

  // True when SAP confirmed the lock/unlock, false when ADT made no call we
  // could see (for example the object was already in that state). Throws
  // when SAP refused, quoting SAP's text when ADT's trace has it.
  async function runLockCommand(uri: string, method: LockMethod, action: 'Lock' | 'Unlock'): Promise<boolean> {
    assertNoUnsavedRelated(uri, action === 'Lock' ? 'lock' : 'unlock');
    const since = Date.now();
    await runOnActiveEditor(uri, `adt-vscode.${method}`);
    const destination = destinationOf(uri) ?? '';
    const httpAction = action === 'Lock' ? 'LOCK' : 'UNLOCK';
    // ADT locks the whole object, and its HTTP log names it last in the path
    // (../oo/classes/zcl_demo?_action=LOCK), so a lock the user runs on
    // another object at the same moment is not mistaken for ours.
    const objectName = classifyFile(lastSegment(uri))?.name;
    const [status, reply] = await Promise.all([
      adtComm.lockStatusSince(httpAction, destination, objectName, since, SAP_REASON_WAIT_MS),
      adtTrace.lockReplySince(method, since, SAP_REASON_WAIT_MS),
    ]);
    if (reply?.errorMessage) throw new ToolError(`${action} failed. SAP says: ${reply.errorMessage}`);
    if (reply?.lockingSupported === false) throw new ToolError(`${action} failed. SAP says this object does not support locking.`);
    if (status !== undefined && status >= 400) {
      const reasons = await adtLog.errorsSince(since, 0);
      const detail = reasons.length > 0
        ? ` SAP says: ${reasons.join(' | ')}`
        : status === 403 && action === 'Lock'
          ? ' This usually means another session (another VS Code window, SAP GUI or Eclipse) is editing the object, or a stale lock is left; close that session or remove the entry in SM12.'
          : '';
      throw new ToolError(`${action} failed: SAP answered HTTP ${status} to ${httpAction}.${detail}`);
    }
    return status !== undefined || reply?.operationExecuted === true;
  }

  function waitForDiagnostics(uri: string, since: number): Promise<void> {
    if ((lastDiagnosticsChange.get(uri) ?? 0) > since) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        listener.dispose();
        resolve();
      }, DIAGNOSTICS_WAIT_MS);
      const listener = vscode.languages.onDidChangeDiagnostics((event) => {
        if (event.uris.some((u) => u.toString() === uri)) {
          clearTimeout(timer);
          listener.dispose();
          resolve();
        }
      });
    });
  }

  function mapDiagnostics(uri: string): DiagnosticInfo[] {
    return vscode.languages.getDiagnostics(toUri(uri)).map((d) => ({
      severity: SEVERITY[d.severity] ?? 'info',
      line: d.range.start.line + 1,
      message: d.message,
    }));
  }

  // Runs ADT's syntax check and waits for its diagnostics, without activating.
  async function runCheck(uri: string): Promise<DiagnosticInfo[]> {
    const key = toUri(uri).toString();
    const before = Date.now();
    await runOnActiveEditor(uri, 'adt-vscode.checkObject');
    lastOperation.set(key, before);
    await waitForDiagnostics(key, before);
    return mapDiagnostics(uri);
  }

  async function snippetsFor(locations: vscode.Location[]): Promise<Map<string, string[]>> {
    const files = [...new Set(locations.map((l) => l.uri.toString()))].slice(0, MAX_SNIPPET_FILES);
    const lines = new Map<string, string[]>();
    await Promise.all(
      files.map(async (file) => {
        try {
          const bytes = await vscode.workspace.fs.readFile(toUri(file));
          lines.set(file, Buffer.from(bytes).toString('utf8').split(/\r?\n/));
        } catch {
          // no snippet for files we cannot read
        }
      })
    );
    return lines;
  }

  return {
    async listSystems(): Promise<SystemInfo[]> {
      const systems = new Map<string, SystemInfo>();
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (folder.uri.scheme !== 'abap') continue;
        const destination = destinationOf(folder.uri.toString());
        if (destination && !systems.has(destination)) {
          systems.set(destination, { destination, rootUri: folder.uri.toString() });
        }
      }
      return [...systems.values()];
    },

    async readDirectory(uri: string): Promise<DirEntry[]> {
      const parent = toUri(uri);
      try {
        const entries = await vscode.workspace.fs.readDirectory(parent);
        return entries.map(([name, type]) => ({
          name,
          kind: type & vscode.FileType.Directory ? ('folder' as const) : ('file' as const),
          uri: vscode.Uri.joinPath(parent, name).toString(),
        }));
      } catch (error) {
        throw asToolError(error, uri);
      }
    },

    async readFile(uri: string): Promise<string> {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === toUri(uri).toString());
      if (open && !open.isDirty) return open.getText();
      try {
        return Buffer.from(await vscode.workspace.fs.readFile(toUri(uri))).toString('utf8');
      } catch (error) {
        throw asToolError(error, uri);
      }
    },

    async writeSource(uri: string, source: string, baseHash: string): Promise<{ newHash: string }> {
      await ensureAdt();
      const document = await vscode.workspace.openTextDocument(toUri(uri));
      if (document.isDirty) {
        throw new ToolError('This object has unsaved changes in VS Code. Save or revert them there first.');
      }
      if (sha256Hex(document.getText()) !== baseHash) throw new StaleSourceError();
      const startedAt = Date.now();
      lastOperation.set(document.uri.toString(), startedAt);

      // writeFile on abap:// is a no-op for open documents, so edit + save.
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), source);
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw await failureWithSapReason(
          'VS Code rejected the edit. Nothing was saved.',
          startedAt,
          'The object may be locked by another user or read-only'
        );
      }
      let saved = false;
      try {
        saved = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'abap-mirror: saving for an MCP client. If SAP asks for a transport request, pick one.',
          },
          () => Promise.resolve(document.save())
        );
      } catch (error) {
        await revertDocument(document);
        throw await failureWithSapReason(
          `Save failed: ${error instanceof Error ? error.message : String(error)}. Nothing was saved.`,
          startedAt,
          'No further detail was available'
        );
      }
      if (!saved) {
        await revertDocument(document);
        throw await failureWithSapReason(
          'Save was cancelled or failed in VS Code. Nothing was saved.',
          startedAt,
          'Possible causes: a lock held by another user, or no transport request'
        );
      }
      log(`saved ${uri}`);
      return { newHash: sha256Hex(document.getText()) };
    },

    async check(uri: string): Promise<DiagnosticInfo[]> {
      return runCheck(uri);
    },

    unsavedRelated,

    async activate(uri: string): Promise<void> {
      const key = toUri(uri).toString();
      assertNoUnsavedRelated(uri, 'activate');
      // Check first so a syntax error surfaces as diagnostics instead of
      // SAP's own interactive "activate anyway?" dialog. Only activate when
      // the check comes back clean.
      const checkDiagnostics = await runCheck(uri);
      if (checkDiagnostics.some((d) => d.severity === 'error')) return;
      // Checked again: the syntax check takes seconds and the user may type meanwhile.
      assertNoUnsavedRelated(uri, 'activate');
      const beforeActivate = Date.now();
      await runOnActiveEditor(uri, 'adt-vscode.activate');
      lastOperation.set(key, beforeActivate);
    },

    async lock(uri: string): Promise<'locked' | 'unknown'> {
      return (await runLockCommand(uri, 'lockFile', 'Lock')) ? 'locked' : 'unknown';
    },

    async unlock(uri: string): Promise<'unlocked' | 'unknown'> {
      return (await runLockCommand(uri, 'unlockFile', 'Unlock')) ? 'unlocked' : 'unknown';
    },

    async diagnostics(uri: string): Promise<DiagnosticInfo[]> {
      const key = toUri(uri).toString();
      const since = lastOperation.get(key);
      if (since !== undefined) await waitForDiagnostics(key, since);
      return mapDiagnostics(uri);
    },

    async references(uri: string, line: number, character: number): Promise<ReferenceLocation[]> {
      await ensureAdt();
      const document = await vscode.workspace.openTextDocument(toUri(uri));
      const locations =
        (await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          document.uri,
          new vscode.Position(line, character)
        )) ?? [];
      const lines = await snippetsFor(locations);
      return locations.map((l) => ({
        uri: l.uri.toString(),
        line: l.range.start.line + 1,
        snippet: lines.get(l.uri.toString())?.[l.range.start.line] ?? '',
      }));
    },

    async pickObjectInteractively(destination: string, query: string): Promise<string | undefined> {
      await ensureAdt();
      await vscode.env.clipboard.writeText(query);
      return new Promise<string | undefined>((resolve) => {
        const subscriptions: vscode.Disposable[] = [];
        let done = false;
        // Idempotent: a resolved pick and the toast's own dismissal can both
        // try to finish this promise, only the first call matters.
        const finish = (value: string | undefined): void => {
          if (done) return;
          done = true;
          subscriptions.forEach((s) => s.dispose());
          resolve(value);
        };
        subscriptions.push(
          vscode.workspace.onDidOpenTextDocument((d) => {
            if (d.uri.scheme === 'abap') finish(d.uri.toString());
          }),
          vscode.window.onDidChangeActiveTextEditor((e) => {
            if (e && e.document.uri.scheme === 'abap') finish(e.document.uri.toString());
          })
        );
        void vscode.window
          .showInformationMessage(
            `abap-mirror: an MCP client is looking for "${query}" on ${destination}. ` +
              'Pick it in the Open Object dialog (the name is on your clipboard).',
            'Cancel'
          )
          // Cancel or dismissal (choice undefined) both mean no pick happened.
          .then(() => finish(undefined));
        void vscode.commands.executeCommand('adt-vscode.openAbapObject').then(undefined, (error: unknown) => {
          log(`openAbapObject failed: ${error instanceof Error ? error.message : String(error)}`);
          finish(undefined);
        });
      });
    },

    dispose(): void {
      diagnosticsListener.dispose();
    },
  };
}
