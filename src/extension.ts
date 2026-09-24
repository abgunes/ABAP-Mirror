import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  collectLeaves,
  shouldConfirm,
  runWithConcurrency,
  DEFAULT_CONFIRM_THRESHOLD,
  DEFAULT_READ_CONCURRENCY,
} from './folderMirror';
import { createSyncStateStore } from './syncState';
import { MirrorTreeDataProvider, MirrorDecorationProvider } from './mirrorTreeProvider';
import { collectUnsyncedMirrorPaths, MirrorNode } from './mirrorTree';
import { TypeIconResolver } from './typeIconResolver';
import { detectAbapObjectType } from './abapObjectType';
import { openTypeIconSettingsPanel } from './typeIconSettingsPanel';
import { safeSegment } from './mirrorPath';
import { createMirrorWriteScheduler } from './mirrorWriteScheduler';
import { registerMcp } from './mcp/lifecycle';

const MIRROR_ROOT = path.join(os.homedir(), '.abap-mirror');
const mirrorToAbapUri = new Map<string, string>();

function resolveObjectTypeForMirror(mirrorPath: string): string {
  const abapUriString = mirrorToAbapUri.get(mirrorPath);
  if (!abapUriString) {
    outputChannel.appendLine(`Type icon: no tracked abap:// URI for ${mirrorPath}, showing UNKNOWN`);
    return 'UNKNOWN';
  }
  const segments = vscode.Uri.parse(abapUriString).path.split('/').filter(Boolean);
  const type = detectAbapObjectType(segments);
  if (type === 'UNKNOWN') {
    outputChannel.appendLine(
      `Type icon: could not detect a type for ${mirrorPath} (abap uri: ${abapUriString}, segments: ${JSON.stringify(segments)})`
    );
  }
  return type;
}
// abap uris whose mirror the user closed on purpose: do not auto-reopen
// until the abap tab itself is closed and reopened fresh.
const manuallyClosedMirrors = new Set<string>();
// abap uris that already got their one automatic reveal. After that,
// refocusing the abap tab must NOT steal focus back to the mirror; the
// user has to ask for it again via the "Open Mirrored File" command.
const autoRevealedMirrors = new Set<string>();
const syncStateStore = createSyncStateStore();
// mirror paths registered via the bulk "Mirror Folder" command. Unlike
// single-object mirrors, these keep their mirrorToAbapUri entry even after
// their ADT tab closes, so a later edit can still find its way back.
const bulkTrackedMirrors = new Set<string>();
// where per-object failures during bulk mirroring are logged, since the
// progress notification only has room for a final count.
const outputChannel = vscode.window.createOutputChannel('ABAP Mirror');

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration('abapMirror').get('enabled', true);
}

function mirrorPathFor(uri: vscode.Uri): string {
  const segments = uri.path.split('/').filter(Boolean).map(safeSegment);
  const leaf = segments.pop() || 'unnamed';
  // Nest mirrors under a folder tree matching the ABAP repository path, so
  // the leaf filename can stay short and readable (shown as the tab title)
  // while still being unique on disk.
  const dir = path.join(MIRROR_ROOT, ...segments);
  // Always end in .abapmirror, a private extension this same package owns
  // a grammar for (see syntaxes/abap-mirror.tmLanguage.json), giving
  // ABAP-like coloring without ever matching ADT's own *.prog.abap /
  // *.ddls.acds / etc. registrations. Matching one of those would hand the
  // mirror to ADT's language server/Joule completion, which fails trying
  // to resolve an ABAP project for a path that isn't part of any real one.
  const rawPath = path.join(dir, `${leaf}.abapmirror`);
  // Route through vscode.Uri so the result matches VS Code's own drive-letter
  // casing/normalization. Otherwise this string won't equal the fsPath VS
  // Code reports back from tabs, visibleTextEditors, or the file watcher,
  // and every comparison against it silently fails on Windows.
  const resolved = vscode.Uri.file(rawPath).fsPath;
  // Defense in depth: safeSegment already neutralizes "." / ".." so no segment
  // can climb out, but assert containment so any future regression fails loudly
  // instead of writing outside the mirror root.
  const rootWithSep = vscode.Uri.file(MIRROR_ROOT).fsPath + path.sep;
  if (!(resolved + path.sep).startsWith(rootWithSep)) {
    throw new Error(`ABAP Mirror: refusing to map ${uri.toString()} outside the mirror root`);
  }
  return resolved;
}

function writeMirrorIfChanged(mirrorPath: string, content: string): void {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(mirrorPath, 'utf8');
  } catch {
    // mirror doesn't exist yet
  }
  if (existing === content) return;
  const dir = path.dirname(mirrorPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mirrorPath, content, 'utf8');
}

async function pushMirrorChangeToAbap(mirrorPath: string): Promise<void> {
  if (!isEnabled()) return;
  const abapUriString = mirrorToAbapUri.get(mirrorPath);
  if (!abapUriString) return;

  let abapDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === abapUriString);
  let needsReveal = false;

  if (!abapDoc) {
    try {
      abapDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(abapUriString));
      needsReveal = true;
    } catch (e) {
      const message = `ABAP Mirror: could not reopen ${abapUriString} to sync change back (${(e as Error).message})`;
      outputChannel.appendLine(message);
      syncStateStore.markError(mirrorPath);
      offerRetry(mirrorPath, message);
      return;
    }
  }

  let newContent: string;
  try {
    newContent = fs.readFileSync(mirrorPath, 'utf8');
  } catch (e) {
    const message = `ABAP Mirror: could not read mirror file ${mirrorPath} to sync its change back (${(e as Error).message})`;
    outputChannel.appendLine(message);
    syncStateStore.markError(mirrorPath);
    return;
  }
  if (abapDoc.getText() === newContent) return;

  // Only reveal/focus a freshly-reopened tab once we know an edit is
  // actually about to be applied. A no-op mirror write (content already
  // matches) must not pop open and steal focus for nothing.
  if (needsReveal) {
    await vscode.window.showTextDocument(abapDoc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
      preserveFocus: false,
    });
  }

  const fullRange = new vscode.Range(
    abapDoc.positionAt(0),
    abapDoc.positionAt(abapDoc.getText().length)
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(abapDoc.uri, fullRange, newContent);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    const message = `ABAP Mirror: could not sync the change back into ${abapUriString} (the edit was rejected, possibly a concurrent change).`;
    outputChannel.appendLine(message);
    syncStateStore.markError(mirrorPath);
    offerRetry(mirrorPath, message);
  }
}

function offerRetry(mirrorPath: string, message: string): void {
  vscode.window.showErrorMessage(message, 'Try Again').then(choice => {
    if (choice === 'Try Again') {
      pushMirrorChangeToAbap(mirrorPath);
    }
  });
}

async function closeMirrorEditor(mirrorPath: string): Promise<void> {
  const mirrorUriString = vscode.Uri.file(mirrorPath).toString();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === mirrorUriString) {
        await vscode.window.tabGroups.close(tab);
      }
    }
  }
}

async function revealMirror(doc: vscode.TextDocument, { force = false } = {}): Promise<void> {
  const mirrorPath = mirrorPathFor(doc.uri);
  mirrorToAbapUri.set(mirrorPath, doc.uri.toString());
  writeMirrorIfChanged(mirrorPath, doc.getText());
  syncStateStore.register(mirrorPath);

  const isMirrorVisible = vscode.window.visibleTextEditors.some(
    e => e.document.uri.fsPath === mirrorPath
  );
  // Only reveal+focus when the mirror isn't already open somewhere. This
  // must NOT depend on "which abap uri was last revealed", or toggling
  // between two different ABAP tabs makes each look "new" again and
  // steals focus back every time you click the original tab.
  if (isMirrorVisible && !force) return;

  const mirrorUri = vscode.Uri.file(mirrorPath);
  const mirrorDoc = await vscode.workspace.openTextDocument(mirrorUri);
  await vscode.window.showTextDocument(mirrorDoc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    preserveFocus: false,
  });
}

async function handleActiveEditorChange(editor: vscode.TextEditor | undefined): Promise<void> {
  if (!editor || !isEnabled()) return;
  const doc = editor.document;
  if (doc.uri.scheme !== 'abap') return;

  const uriString = doc.uri.toString();
  const mirrorPath = mirrorPathFor(doc.uri);
  mirrorToAbapUri.set(mirrorPath, uriString);
  writeMirrorIfChanged(mirrorPath, doc.getText());
  syncStateStore.register(mirrorPath);

  // Respect a manual close of the mirror tab: do not force it back open
  // just because you clicked back onto the original ABAP tab.
  if (manuallyClosedMirrors.has(uriString)) return;

  // Only auto-reveal the very first time this ABAP doc becomes active in
  // this session. Every later refocus (e.g. clicking away and back) must
  // leave the mirror alone. Reopening it on demand is what the
  // "ABAP Mirror - Open Mirror Object" command/context-menu entry is for.
  if (autoRevealedMirrors.has(uriString)) return;
  autoRevealedMirrors.add(uriString);

  await revealMirror(doc);
}

async function openMirrorCommand(uriArg: unknown): Promise<void> {
  if (!isEnabled()) {
    vscode.window.showWarningMessage('ABAP Mirror is disabled (abapMirror.enabled).');
    return;
  }

  let uri = uriArg instanceof vscode.Uri ? uriArg : undefined;
  if (!uri && vscode.window.activeTextEditor) {
    uri = vscode.window.activeTextEditor.document.uri;
  }
  if (!uri || uri.scheme !== 'abap') {
    vscode.window.showWarningMessage('ABAP Mirror: pick an open ABAP (abap://) document first.');
    return;
  }

  const uriString = uri.toString();
  let doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uriString);
  if (!doc) doc = await vscode.workspace.openTextDocument(uri);

  // An explicit ask to open always wins over a prior manual close, and
  // counts as this doc's "already revealed" moment too.
  manuallyClosedMirrors.delete(uriString);
  autoRevealedMirrors.add(uriString);

  await revealMirror(doc, { force: true });
}

async function mirrorFolderCommand(uriArg: unknown): Promise<void> {
  if (!isEnabled()) {
    vscode.window.showWarningMessage('ABAP Mirror is disabled (abapMirror.enabled).');
    return;
  }

  const folderUri = uriArg instanceof vscode.Uri ? uriArg : undefined;
  if (!folderUri || folderUri.scheme !== 'abap') {
    vscode.window.showWarningMessage('ABAP Mirror: right-click an ABAP (abap://) folder to mirror it.');
    return;
  }

  const fsLike = { readDirectory: (uri: vscode.Uri) => Promise.resolve(vscode.workspace.fs.readDirectory(uri)) };
  const joinChild = (parentUri: vscode.Uri, name: string) => vscode.Uri.joinPath(parentUri, name);

  let leaves: vscode.Uri[];
  let scanCancelled = false;
  try {
    leaves = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'ABAP Mirror: scanning folder for objects', cancellable: true },
      async (progress, token) => {
        let found = 0;
        const result = await collectLeaves(
          fsLike,
          vscode.FileType.Directory,
          folderUri,
          joinChild,
          (uri, e) => outputChannel.appendLine(`Could not list ${uri.toString()}: ${e.message}`),
          () => progress.report({ message: `${++found} object(s) found` }),
          () => token.isCancellationRequested
        );
        scanCancelled = token.isCancellationRequested;
        return result;
      }
    );
  } catch (e) {
    vscode.window.showErrorMessage(`ABAP Mirror: could not read folder contents (${(e as Error).message})`);
    return;
  }

  if (scanCancelled) {
    vscode.window.showInformationMessage('ABAP Mirror: folder scan cancelled.');
    return;
  }

  if (leaves.length === 0) {
    vscode.window.showInformationMessage('ABAP Mirror: this folder has no objects to mirror.');
    return;
  }

  if (shouldConfirm(leaves.length, DEFAULT_CONFIRM_THRESHOLD)) {
    const choice = await vscode.window.showWarningMessage(
      `Mirror ${leaves.length} objects under ${folderUri.path}? This may take a while.`,
      'Mirror',
      'Cancel'
    );
    if (choice !== 'Mirror') return;
  }

  let mirrored = 0;
  let skipped = 0;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'ABAP Mirror: mirroring folder', cancellable: true },
    async (progress, token) => {
      await runWithConcurrency(
        leaves,
        async (objectUri) => {
          try {
            const bytes = await vscode.workspace.fs.readFile(objectUri);
            const content = Buffer.from(bytes).toString('utf8');
            const mirrorPath = mirrorPathFor(objectUri);
            mirrorToAbapUri.set(mirrorPath, objectUri.toString());
            bulkTrackedMirrors.add(mirrorPath);
            writeMirrorIfChanged(mirrorPath, content);
            syncStateStore.register(mirrorPath);
            mirrored++;
          } catch (e) {
            outputChannel.appendLine(`Skipped ${objectUri.toString()}: ${(e as Error).message}`);
            skipped++;
          }
          progress.report({ message: `${mirrored + skipped} / ${leaves.length}` });
        },
        { concurrency: DEFAULT_READ_CONCURRENCY, isCancelled: () => token.isCancellationRequested }
      );
    }
  );

  vscode.window.showInformationMessage(
    `ABAP Mirror: ${mirrored} object(s) mirrored${skipped ? `, ${skipped} skipped (see "ABAP Mirror" output channel for details)` : ''}.`
  );
}

async function retrySyncErrorsCommand(): Promise<void> {
  const errored = syncStateStore.entries().filter(entry => entry.state === 'error');
  if (errored.length === 0) {
    vscode.window.showInformationMessage('ABAP Mirror: no failed syncs to retry.');
    return;
  }

  const picks = errored.map(entry => ({
    label: path.relative(MIRROR_ROOT, entry.mirrorPath),
    mirrorPath: entry.mirrorPath,
    picked: true,
  }));

  const selected = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    placeHolder: `Select which of ${errored.length} failed sync(s) to retry`,
  });
  if (!selected || selected.length === 0) return;

  let succeeded = 0;
  for (const pick of selected) {
    await pushMirrorChangeToAbap(pick.mirrorPath);
    if (syncStateStore.get(pick.mirrorPath) !== 'error') succeeded++;
  }

  vscode.window.showInformationMessage(
    `ABAP Mirror: retried ${selected.length} sync(s), ${succeeded} succeeded.`
  );
}

async function retrySyncForItemCommand(node: MirrorNode | undefined): Promise<void> {
  if (!node || node.type !== 'object') return;
  if (node.state === 'synced') {
    vscode.window.showInformationMessage('ABAP Mirror: this object is already synced.');
    return;
  }
  await pushMirrorChangeToAbap(node.fullPath);
}

async function retrySyncForFolderCommand(node: MirrorNode | undefined): Promise<void> {
  if (!node || node.type !== 'folder') return;
  const mirrorPaths = collectUnsyncedMirrorPaths(node);
  if (mirrorPaths.length === 0) {
    vscode.window.showInformationMessage('ABAP Mirror: everything under this folder is already synced.');
    return;
  }

  let succeeded = 0;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `ABAP Mirror: retrying sync for ${mirrorPaths.length} object(s)`,
      cancellable: false,
    },
    async progress => {
      for (const [index, mirrorPath] of mirrorPaths.entries()) {
        await pushMirrorChangeToAbap(mirrorPath);
        if (syncStateStore.get(mirrorPath) !== 'error') succeeded++;
        progress.report({ message: `${index + 1} / ${mirrorPaths.length}` });
      }
    }
  );

  vscode.window.showInformationMessage(
    `ABAP Mirror: retried ${mirrorPaths.length} object(s) under this folder, ${succeeded} now synced.`
  );
}

export function activate(context: vscode.ExtensionContext): void {
  if (!fs.existsSync(MIRROR_ROOT)) fs.mkdirSync(MIRROR_ROOT, { recursive: true });

  const typeIconCacheDir = path.join(context.globalStorageUri.fsPath, 'type-icons');
  const typeIconResolver = new TypeIconResolver(typeIconCacheDir);
  const mirrorTreeProvider = new MirrorTreeDataProvider(
    MIRROR_ROOT,
    syncStateStore,
    resolveObjectTypeForMirror,
    typeIconResolver
  );
  context.subscriptions.push(vscode.window.registerTreeDataProvider('abapMirror.files', mirrorTreeProvider));
  context.subscriptions.push(mirrorTreeProvider);

  const mirrorDecorationProvider = new MirrorDecorationProvider(syncStateStore);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(mirrorDecorationProvider));
  context.subscriptions.push(mirrorDecorationProvider);

  const mirrorWriteScheduler = createMirrorWriteScheduler(
    (mirrorPath, content) => writeMirrorIfChanged(mirrorPath, content)
  );
  context.subscriptions.push({ dispose: () => mirrorWriteScheduler.dispose() });

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(handleActiveEditorChange));
  context.subscriptions.push(vscode.commands.registerCommand('abapMirror.open', openMirrorCommand));
  context.subscriptions.push(vscode.commands.registerCommand('abapMirror.folder', mirrorFolderCommand));
  context.subscriptions.push(
    vscode.commands.registerCommand('abapMirror.configureTypeIcons', openTypeIconSettingsPanel)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('abapMirror.retrySyncErrors', retrySyncErrorsCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('abapMirror.retrySyncForItem', retrySyncForItemCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('abapMirror.retrySyncForFolder', retrySyncForFolderCommand)
  );
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('abapMirror.typeIcons') || e.affectsConfiguration('abapMirror.icons.enableInMirrorPanel')) {
      // Deliberately DO NOT wipe the icon cache here. The cache is
      // content-addressed: getIconUri() computes each filename from the
      // current (abbreviation, color, dirty) read fresh from config, so a
      // changed color already resolves to a brand-new file and Uri, and the
      // previous color's file simply becomes a harmless orphan. Wiping the
      // whole directory on every save deleted still-valid files for types
      // the user did NOT change (e.g. BDEF while editing DDLS), and that
      // synchronous delete raced the renderer's asynchronous SVG load,
      // leaving unchanged rows with no icon after a save. Refresh alone is
      // enough to re-render with the updated colors.
      mirrorTreeProvider.refresh();
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
    if (isEnabled() && e.document.uri.scheme === 'abap') {
      const mirrorPath = mirrorPathFor(e.document.uri);
      mirrorToAbapUri.set(mirrorPath, e.document.uri.toString());
      mirrorWriteScheduler.schedule(mirrorPath, e.document.getText());
      if (e.document.isDirty) {
        syncStateStore.markChanged(mirrorPath);
      } else {
        syncStateStore.markSynced(mirrorPath);
      }
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
    if (isEnabled() && doc.uri.scheme === 'abap') {
      const mirrorPath = mirrorPathFor(doc.uri);
      syncStateStore.markSynced(mirrorPath);
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
    if (!isEnabled()) return;

    if (doc.uri.scheme === 'abap') {
      // Original ABAP tab closed: close its mirror too and forget any
      // manual-close/auto-revealed state, so reopening the object later
      // reveals fresh. Forgetting a single-object mirror also removes it
      // from the ABAP Mirror Files panel, not just from push-back tracking.
      // Bulk-tracked mirrors (from "Mirror Folder") keep their tracking
      // entry so a later edit can still sync back.
      const mirrorPath = mirrorPathFor(doc.uri);
      if (!bulkTrackedMirrors.has(mirrorPath)) {
        mirrorToAbapUri.delete(mirrorPath);
        syncStateStore.unregister(mirrorPath);
      }
      manuallyClosedMirrors.delete(doc.uri.toString());
      autoRevealedMirrors.delete(doc.uri.toString());
      closeMirrorEditor(mirrorPath);
      return;
    }

    if (doc.uri.scheme === 'file') {
      // A mirror tab closed while its ABAP source is still open. That is
      // a deliberate user action, remember it so we don't snap it back
      // open the next time the ABAP tab regains focus.
      const abapUriString = mirrorToAbapUri.get(doc.uri.fsPath);
      if (abapUriString) manuallyClosedMirrors.add(abapUriString);
    }
  }));

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(MIRROR_ROOT, '**/*')
  );
  context.subscriptions.push(watcher);
  context.subscriptions.push(watcher.onDidChange(uri => pushMirrorChangeToAbap(uri.fsPath)));

  if (vscode.window.activeTextEditor) {
    handleActiveEditorChange(vscode.window.activeTextEditor);
  }

  // The MCP server is an independent, opt-in feature; a failure there must
  // never take the mirror down with it.
  try {
    registerMcp(context);
  } catch (error) {
    console.error('ABAP Mirror: MCP server setup failed', error);
  }
}

export function deactivate(): void {}
