import { EventEmitter } from 'node:events';

export type SyncState = 'synced' | 'changed' | 'error';

export interface SyncStateStore {
  register(mirrorPath: string): void;
  markChanged(mirrorPath: string): void;
  markSynced(mirrorPath: string): void;
  markError(mirrorPath: string): void;
  unregister(mirrorPath: string): void;
  get(mirrorPath: string): SyncState | undefined;
  entries(): Array<{ mirrorPath: string; state: SyncState }>;
  onDidChange(listener: () => void): { dispose(): void };
}

export function createSyncStateStore(): SyncStateStore {
  const state = new Map<string, SyncState>();
  const emitter = new EventEmitter();

  return {
    register(mirrorPath) {
      if (!state.has(mirrorPath)) {
        state.set(mirrorPath, 'synced');
        emitter.emit('change');
      }
    },
    markChanged(mirrorPath) {
      if (state.get(mirrorPath) !== 'changed') {
        state.set(mirrorPath, 'changed');
        emitter.emit('change');
      }
    },
    markSynced(mirrorPath) {
      if (state.get(mirrorPath) !== 'synced') {
        state.set(mirrorPath, 'synced');
        emitter.emit('change');
      }
    },
    markError(mirrorPath) {
      if (state.get(mirrorPath) !== 'error') {
        state.set(mirrorPath, 'error');
        emitter.emit('change');
      }
    },
    unregister(mirrorPath) {
      if (state.delete(mirrorPath)) {
        emitter.emit('change');
      }
    },
    get(mirrorPath) {
      return state.get(mirrorPath);
    },
    entries() {
      return Array.from(state.entries()).map(([mirrorPath, s]) => ({ mirrorPath, state: s }));
    },
    onDidChange(listener) {
      emitter.on('change', listener);
      return { dispose: () => void emitter.off('change', listener) };
    },
  };
}
