import * as vscode from 'vscode';
import { buildMirrorTree, folderContainsChanged, MirrorFolderNode, MirrorNode } from './mirrorTree';
import type { SyncStateStore } from './syncState';
import type { TypeIconResolver } from './typeIconResolver';

export class MirrorTreeDataProvider implements vscode.TreeDataProvider<MirrorNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _tree: MirrorFolderNode | null = null;
  private readonly _syncListener: { dispose(): void };

  constructor(
    private readonly mirrorRoot: string,
    private readonly syncStateStore: SyncStateStore,
    private readonly resolveObjectType: (mirrorPath: string) => string,
    private readonly iconResolver: TypeIconResolver
  ) {
    this._syncListener = syncStateStore.onDidChange(() => this.refresh());
    this.refresh();
  }

  refresh(): void {
    const entries = this.syncStateStore.entries().map(entry => ({
      ...entry,
      objectType: this.resolveObjectType(entry.mirrorPath),
    }));
    this._tree = buildMirrorTree(this.mirrorRoot, entries);
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._syncListener.dispose();
  }

  getChildren(element?: MirrorNode): MirrorNode[] {
    const node = element ?? this._tree;
    if (!node || node.type !== 'folder') return [];
    return Array.from(node.children.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  getTreeItem(node: MirrorNode): vscode.TreeItem {
    if (node.type === 'folder') {
      const collapsibleState = folderContainsChanged(node)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      const item = new vscode.TreeItem(node.name, collapsibleState);
      item.resourceUri = vscode.Uri.file(node.fullPath);
      item.contextValue = folderContainsChanged(node) ? 'abapMirrorFolderUnsynced' : 'abapMirrorFolder';
      return item;
    }

    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(node.fullPath);
    item.contextValue = node.state === 'synced' ? 'abapMirrorObject' : 'abapMirrorObjectUnsynced';
    item.command = {
      command: 'vscode.open',
      title: 'Open Mirror File',
      arguments: [vscode.Uri.file(node.fullPath)],
    };
    if (this.iconResolver.isEnabled()) {
      // Anything other than 'synced' (currently 'changed', and 'error' once
      // the sync-error-retry plan adds it) gets the red-box treatment: this
      // object's mirror has not made it back into the ADT document buffer.
      const iconUri = this.iconResolver.getIconUri(node.objectType, node.state !== 'synced');
      if (iconUri) item.iconPath = iconUri;
    }
    return item;
  }
}

export class MirrorDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  private readonly _syncListener: { dispose(): void };

  constructor(private readonly syncStateStore: SyncStateStore) {
    this._syncListener = syncStateStore.onDidChange(() => this._onDidChangeFileDecorations.fire(undefined));
  }

  dispose(): void {
    this._syncListener.dispose();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const state = this.syncStateStore.get(uri.fsPath);
    if (state === 'error') {
      return {
        badge: '!',
        color: new vscode.ThemeColor('charts.orange'),
        tooltip: 'Mirror file: failed to sync back to ADT. See the error notification to retry.',
      };
    }
    if (state === 'changed') {
      return { badge: 'M', color: new vscode.ThemeColor('charts.red'), tooltip: 'Mirror file: unsaved changes pending in ADT' };
    }
    if (state === 'synced') {
      return { badge: 'M', color: new vscode.ThemeColor('charts.blue'), tooltip: 'Mirror file: synced with ADT' };
    }
    return undefined;
  }
}
