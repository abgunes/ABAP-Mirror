const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectLeaves,
  shouldConfirm,
  runWithConcurrency,
  DEFAULT_CONFIRM_THRESHOLD,
} = require('../out/folderMirror');

const DIR = 'directory';
const FILE = 'file';

function makeFakeFs(tree) {
  return {
    async readDirectory(uri) {
      const entries = tree.get(uri);
      if (!entries) throw new Error(`no entries for ${uri}`);
      return entries;
    },
  };
}

function joinChild(parentUri, name) {
  return `${parentUri}/${name}`;
}

test('collectLeaves walks nested folders and returns only leaf uris', async () => {
  const tree = new Map([
    ['root', [['pkgA', DIR], ['obj1.prog.abap', FILE]]],
    ['root/pkgA', [['obj2.clas.abap', FILE], ['pkgB', DIR]]],
    ['root/pkgA/pkgB', [['obj3.ddls.asddls', FILE]]],
  ]);
  const fsLike = makeFakeFs(tree);

  const leaves = await collectLeaves(fsLike, DIR, 'root', joinChild);

  assert.deepEqual(
    leaves.sort(),
    ['root/obj1.prog.abap', 'root/pkgA/obj2.clas.abap', 'root/pkgA/pkgB/obj3.ddls.asddls'].sort()
  );
});

test('collectLeaves returns empty array for an empty folder', async () => {
  const tree = new Map([['root', []]]);
  const fsLike = makeFakeFs(tree);

  const leaves = await collectLeaves(fsLike, DIR, 'root', joinChild);

  assert.deepEqual(leaves, []);
});

test('collectLeaves skips a subfolder whose readDirectory fails, but still walks its siblings and reports the error', async () => {
  const tree = new Map([
    ['root', [['pkgA', DIR], ['pkgB', DIR], ['obj1.prog.abap', FILE]]],
    // 'root/pkgA' is intentionally absent from the tree, so makeFakeFs throws for it.
    ['root/pkgB', [['obj2.clas.abap', FILE]]],
  ]);
  const fsLike = makeFakeFs(tree);
  const errors = [];
  const onError = (uri, error) => errors.push({ uri, error });

  const leaves = await collectLeaves(fsLike, DIR, 'root', joinChild, onError);

  assert.deepEqual(
    leaves.sort(),
    ['root/obj1.prog.abap', 'root/pkgB/obj2.clas.abap'].sort()
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].uri, 'root/pkgA');
  assert.match(errors[0].error.message, /no entries for root\/pkgA/);
});

test('collectLeaves invokes onLeaf once per leaf as it is discovered', async () => {
  const tree = new Map([
    ['root', [['pkgA', DIR], ['obj1.prog.abap', FILE]]],
    ['root/pkgA', [['obj2.clas.abap', FILE]]],
  ]);
  const fsLike = makeFakeFs(tree);
  const seen = [];

  const leaves = await collectLeaves(fsLike, DIR, 'root', joinChild, undefined, (uri) => seen.push(uri));

  assert.deepEqual(seen.sort(), leaves.sort());
  assert.equal(seen.length, 2);
});

test('collectLeaves stops walking once isCancelled returns true, keeping leaves found so far', async () => {
  const tree = new Map([
    ['root', [['pkgA', DIR], ['pkgB', DIR]]],
    ['root/pkgA', [['obj1.prog.abap', FILE]]],
    ['root/pkgB', [['obj2.clas.abap', FILE]]],
  ]);
  const fsLike = makeFakeFs(tree);
  let cancelled = false;

  const leaves = await collectLeaves(
    fsLike,
    DIR,
    'root',
    joinChild,
    undefined,
    () => { cancelled = true; },
    () => cancelled
  );

  assert.deepEqual(leaves, ['root/pkgA/obj1.prog.abap']);
});

test('shouldConfirm is false at or below the threshold, true above it', () => {
  assert.equal(shouldConfirm(DEFAULT_CONFIRM_THRESHOLD), false);
  assert.equal(shouldConfirm(DEFAULT_CONFIRM_THRESHOLD + 1), true);
  assert.equal(shouldConfirm(5, 10), false);
  assert.equal(shouldConfirm(11, 10), true);
});

test('runWithConcurrency runs every item exactly once', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const seen = [];
  await runWithConcurrency(
    items,
    async (item) => {
      seen.push(item);
    },
    { concurrency: 3 }
  );

  assert.deepEqual(seen.sort((a, b) => a - b), items);
});

test('runWithConcurrency never runs more than the configured concurrency at once', async () => {
  const items = [1, 2, 3, 4, 5, 6];
  let active = 0;
  let maxActive = 0;
  await runWithConcurrency(
    items,
    async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    },
    { concurrency: 2 }
  );

  assert.equal(maxActive <= 2, true);
});

test('runWithConcurrency stops starting new work once isCancelled returns true', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const seen = [];
  await runWithConcurrency(
    items,
    async (item) => {
      seen.push(item);
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
    { concurrency: 1, isCancelled: () => seen.length >= 3 }
  );

  assert.equal(seen.length, 3);
});
