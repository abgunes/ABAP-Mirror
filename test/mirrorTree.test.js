// test/mirrorTree.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildMirrorTree, folderContainsChanged, collectUnsyncedMirrorPaths } = require('../out/mirrorTree');

test('buildMirrorTree nests entries under folders matching their path segments', () => {
  const root = path.join('C:', 'mirror-root');
  const entries = [
    { mirrorPath: path.join(root, 'pkgA', 'obj1.abapmirror'), state: 'synced', objectType: 'CLAS' },
    { mirrorPath: path.join(root, 'pkgA', 'pkgB', 'obj2.abapmirror'), state: 'changed', objectType: 'DDLS' },
    { mirrorPath: path.join(root, 'obj3.abapmirror'), state: 'synced', objectType: 'PROG' },
  ];

  const tree = buildMirrorTree(root, entries);

  assert.equal(tree.type, 'folder');
  assert.equal(tree.children.size, 2);
  const pkgA = tree.children.get('pkgA');
  assert.equal(pkgA.type, 'folder');
  assert.equal(pkgA.children.get('obj1.abapmirror').state, 'synced');
  const pkgB = pkgA.children.get('pkgB');
  assert.equal(pkgB.children.get('obj2.abapmirror').state, 'changed');
  assert.equal(tree.children.get('obj3.abapmirror').type, 'object');
  assert.equal(pkgA.children.get('obj1.abapmirror').objectType, 'CLAS');
  assert.equal(pkgB.children.get('obj2.abapmirror').objectType, 'DDLS');
  assert.equal(tree.children.get('obj3.abapmirror').objectType, 'PROG');
});

test('folderContainsChanged is true when any nested descendant is changed', () => {
  const root = path.join('C:', 'mirror-root');
  const entries = [
    { mirrorPath: path.join(root, 'pkgA', 'pkgB', 'obj2.abapmirror'), state: 'changed', objectType: 'CLAS' },
    { mirrorPath: path.join(root, 'obj3.abapmirror'), state: 'synced', objectType: 'CLAS' },
  ];
  const tree = buildMirrorTree(root, entries);

  assert.equal(folderContainsChanged(tree), true);
  assert.equal(folderContainsChanged(tree.children.get('pkgA')), true);
});

test('folderContainsChanged is false when every descendant is synced', () => {
  const root = path.join('C:', 'mirror-root');
  const entries = [
    { mirrorPath: path.join(root, 'pkgA', 'obj1.abapmirror'), state: 'synced', objectType: 'CLAS' },
    { mirrorPath: path.join(root, 'obj3.abapmirror'), state: 'synced', objectType: 'CLAS' },
  ];
  const tree = buildMirrorTree(root, entries);

  assert.equal(folderContainsChanged(tree), false);
});

test('folderContainsChanged also treats an error state as not synced', () => {
  const root = path.join('C:', 'mirror-root');
  const entries = [
    { mirrorPath: path.join(root, 'pkgA', 'obj1.abapmirror'), state: 'error', objectType: 'CLAS' },
    { mirrorPath: path.join(root, 'obj2.abapmirror'), state: 'synced', objectType: 'PROG' },
  ];
  const tree = buildMirrorTree(root, entries);

  assert.equal(folderContainsChanged(tree.children.get('pkgA')), true);
});

test('collectUnsyncedMirrorPaths returns every changed or errored object path under a folder', () => {
  const root = path.join('C:', 'mirror-root');
  const entries = [
    { mirrorPath: path.join(root, 'pkgA', 'obj1.abapmirror'), state: 'changed', objectType: 'CLAS' },
    { mirrorPath: path.join(root, 'pkgA', 'pkgB', 'obj2.abapmirror'), state: 'error', objectType: 'DDLS' },
    { mirrorPath: path.join(root, 'pkgA', 'obj3.abapmirror'), state: 'synced', objectType: 'PROG' },
  ];
  const tree = buildMirrorTree(root, entries);

  const paths = collectUnsyncedMirrorPaths(tree.children.get('pkgA')).sort();
  assert.deepEqual(paths, [
    path.join(root, 'pkgA', 'obj1.abapmirror'),
    path.join(root, 'pkgA', 'pkgB', 'obj2.abapmirror'),
  ].sort());
});

test('collectUnsyncedMirrorPaths on a single synced object returns an empty array', () => {
  const root = path.join('C:', 'mirror-root');
  const entries = [{ mirrorPath: path.join(root, 'obj1.abapmirror'), state: 'synced', objectType: 'CLAS' }];
  const tree = buildMirrorTree(root, entries);

  assert.deepEqual(collectUnsyncedMirrorPaths(tree.children.get('obj1.abapmirror')), []);
});

test('collectUnsyncedMirrorPaths on a single unsynced object returns just that path', () => {
  const root = path.join('C:', 'mirror-root');
  const entries = [{ mirrorPath: path.join(root, 'obj1.abapmirror'), state: 'error', objectType: 'CLAS' }];
  const tree = buildMirrorTree(root, entries);

  assert.deepEqual(collectUnsyncedMirrorPaths(tree.children.get('obj1.abapmirror')), [path.join(root, 'obj1.abapmirror')]);
});
