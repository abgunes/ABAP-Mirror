import * as vscode from 'vscode';
import { destinationOf } from './abapUri';
import { sha256Hex } from './hash';
import {
  AdtBridge,
  DiagnosticInfo,
  DirEntry,
  NotFoundError,
  ReferenceLocation,
  StaleSourceError,
  SystemInfo,
  ToolError,
} from './types';

// The only place where the MCP module talks to VS Code and SAP's ADT
// extension (sapse.adt-vscode). Every SAP call rides on the session that
// extension already holds; abap-mirror never logs in on its own.

const ADT_EXTENSION_ID = 'sapse.adt-vscode';
const DIAGNOSTICS_WAIT_MS = 10_000;
const MAX_SNIPPET_FILES = 50;

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

export function createAdtBridge(log: (line: string) => void): AdtBridge & vscode.Disposable {
  // uri -> time of the last diagnostics change / of our last save or activation.
  const lastDiagnosticsChange = new Map<string, number>();
  const lastOperation = new Map<string, number>();
  const diagnosticsListener = vscode.languages.onDidChangeDiagnostics((event) => {
    const now = Date.now();
    for (const uri of event.uris) lastDiagnosticsChange.set(uri.toString(), now);
  });

  async function ensureAdt(): Promise<void> {
    const extension = vscode.extensions.getExtension(ADT_EXTENSION_ID);
    if (!extension) throw new ToolError(`SAP ADT extension (${ADT_EXTENSION_ID}) is not installed in VS Code.`);
    if (!extension.isActive) await extension.activate();
  }

  // SAP's activate/lock/unlock commands take no arguments and act on the
  // active editor, so show the document, run the command, then give the
  // user their previous editor back.
  async function runOnActiveEditor(uri: string, command: string): Promise<void> {
    await ensureAdt();
    const previous = vscode.window.activeTextEditor;
    const document = await vscode.workspace.openTextDocument(toUri(uri));
    await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
    try {
      await vscode.commands.executeCommand(command);
    } finally {
      if (previous && previous.document.uri.toString() !== document.uri.toString()) {
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
      lastOperation.set(document.uri.toString(), Date.now());

      // writeFile on abap:// is a no-op for open documents, so edit + save.
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), source);
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new ToolError('VS Code rejected the edit. The object may be locked by another user or read-only.');
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
        throw new ToolError(`Save failed: ${error instanceof Error ? error.message : String(error)}. Nothing was saved.`);
      }
      if (!saved) {
        await revertDocument(document);
        throw new ToolError('Save was cancelled or failed in VS Code (for example no transport request). Nothing was saved.');
      }
      log(`saved ${uri}`);
      return { newHash: sha256Hex(document.getText()) };
    },

    async activate(uri: string): Promise<void> {
      lastOperation.set(toUri(uri).toString(), Date.now());
      await runOnActiveEditor(uri, 'adt-vscode.activate');
    },

    async lock(uri: string): Promise<'locked' | 'unknown'> {
      await runOnActiveEditor(uri, 'adt-vscode.lockFile');
      return 'unknown';
    },

    async unlock(uri: string): Promise<'unlocked' | 'unknown'> {
      await runOnActiveEditor(uri, 'adt-vscode.unlockFile');
      return 'unknown';
    },

    async diagnostics(uri: string): Promise<DiagnosticInfo[]> {
      const key = toUri(uri).toString();
      const since = lastOperation.get(key);
      if (since !== undefined) await waitForDiagnostics(key, since);
      return vscode.languages.getDiagnostics(toUri(uri)).map((d) => ({
        severity: SEVERITY[d.severity] ?? 'info',
        line: d.range.start.line + 1,
        message: d.message,
      }));
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
        const finish = (value: string | undefined): void => {
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
          .then((choice) => {
            if (choice === 'Cancel') finish(undefined);
          });
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
