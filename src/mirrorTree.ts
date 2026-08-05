import * as path from 'node:path';
import type { SyncState } from './syncState';

export interface MirrorObjectNode {
  type: 'object';
  name: string;
  fullPath: string;
  state: SyncState;
  objectType: string;
}

export interface MirrorFolderNode {
  type: 'folder';
  name: string;
  fullPath: string;
  children: Map<string, MirrorNode>;
}

export type MirrorNode = MirrorObjectNode | MirrorFolderNode;

export function buildMirrorTree(
  rootPath: string,
  entries: Array<{ mirrorPath: string; state: SyncState; objectType: string }>
): MirrorFolderNode {
  const root: MirrorFolderNode = { type: 'folder', name: path.basename(rootPath), fullPath: rootPath, children: new Map() };

  for (const { mirrorPath, state, objectType } of entries) {
    const rel = path.relative(rootPath, mirrorPath);
    const segments = rel.split(path.sep).filter(Boolean);
    let node: MirrorFolderNode = root;
    let currentPath = rootPath;

    segments.forEach((segment: string, i: number) => {
      currentPath = path.join(currentPath, segment);
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        node.children.set(segment, { type: 'object', name: segment, fullPath: currentPath, state, objectType });
        return;
      }

      if (!node.children.has(segment)) {
        node.children.set(segment, { type: 'folder', name: segment, fullPath: currentPath, children: new Map() });
      }
      node = node.children.get(segment) as MirrorFolderNode;
    });
  }

  return root;
}

export function folderContainsChanged(folderNode: MirrorFolderNode): boolean {
  for (const child of folderNode.children.values()) {
    if (child.type === 'object') {
      if (child.state === 'changed') return true;
    } else if (folderContainsChanged(child)) {
      return true;
    }
  }
  return false;
}
