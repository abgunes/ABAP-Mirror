const test = require('node:test');
const assert = require('node:assert/strict');
const { createSyncStateStore } = require('../out/syncState');

test('register sets a new mirror path to synced', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), 'synced');
});

test('register does not overwrite an existing entry', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.markChanged('/mirror/a.abapmirror');
  store.register('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), 'changed');
});

test('markChanged then markSynced transitions correctly', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.markChanged('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), 'changed');
  store.markSynced('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), 'synced');
});

test('markError transitions a registered mirror to error', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.markError('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), 'error');
});

test('a later markChanged clears an error state back to changed', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.markError('/mirror/a.abapmirror');
  store.markChanged('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), 'changed');
});

test('a later markSynced clears an error state back to synced', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.markError('/mirror/a.abapmirror');
  store.markSynced('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), 'synced');
});

test('onDidChange fires once when transitioning into error state', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  let fireCount = 0;
  store.onDidChange(() => {
    fireCount++;
  });
  store.markError('/mirror/a.abapmirror');
  assert.equal(fireCount, 1);
});

test('markError is a no-op if already in error state', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.markError('/mirror/a.abapmirror');
  let fireCount = 0;
  store.onDidChange(() => {
    fireCount++;
  });
  store.markError('/mirror/a.abapmirror');
  assert.equal(fireCount, 0);
});

test('entries lists every tracked mirror path with its state', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.register('/mirror/b.abapmirror');
  store.markChanged('/mirror/b.abapmirror');

  const entries = store.entries().sort((x, y) => x.mirrorPath.localeCompare(y.mirrorPath));
  assert.deepEqual(entries, [
    { mirrorPath: '/mirror/a.abapmirror', state: 'synced' },
    { mirrorPath: '/mirror/b.abapmirror', state: 'changed' },
  ]);
});

test('onDidChange fires once per actual state transition, not on no-op calls', () => {
  const store = createSyncStateStore();
  let fireCount = 0;
  store.onDidChange(() => {
    fireCount++;
  });

  store.register('/mirror/a.abapmirror');
  store.markSynced('/mirror/a.abapmirror');
  store.markChanged('/mirror/a.abapmirror');
  store.markChanged('/mirror/a.abapmirror');

  assert.equal(fireCount, 2);
});

test('unregister removes an entry so get returns undefined', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.unregister('/mirror/a.abapmirror');
  assert.equal(store.get('/mirror/a.abapmirror'), undefined);
});

test('unregister removes only the given path from entries', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  store.register('/mirror/b.abapmirror');
  store.unregister('/mirror/a.abapmirror');

  const entries = store.entries().sort((x, y) => x.mirrorPath.localeCompare(y.mirrorPath));
  assert.deepEqual(entries, [
    { mirrorPath: '/mirror/b.abapmirror', state: 'synced' },
  ]);
});

test('unregister fires onDidChange exactly once for an existing entry', () => {
  const store = createSyncStateStore();
  store.register('/mirror/a.abapmirror');
  let fireCount = 0;
  store.onDidChange(() => {
    fireCount++;
  });

  store.unregister('/mirror/a.abapmirror');

  assert.equal(fireCount, 1);
});

test('unregister on a path that was never registered is a no-op', () => {
  const store = createSyncStateStore();
  let fireCount = 0;
  store.onDidChange(() => {
    fireCount++;
  });

  assert.doesNotThrow(() => store.unregister('/mirror/never-registered.abapmirror'));
  assert.equal(fireCount, 0);
});
