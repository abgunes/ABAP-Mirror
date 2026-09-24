const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crawlDestination, ObjectIndex, wildcardToRegExp } = require('../out/mcp/objectIndex');
const { createFileIndexStore, indexFileName } = require('../out/mcp/indexStore');
const { ROOT, CLASS_FOLDER, buildTree, defaultTreeSpec, createMemoryIndexStore } = require('./helpers/mcpFakes');

function readerFor(spec) {
  const tree = buildTree(spec);
  const reads = [];
  const read = async (uri) => {
    reads.push(uri);
    const children = tree.folders.get(uri);
    if (!children) throw new Error(`no folder ${uri}`);
    return children;
  };
  return { read, reads };
}

test('crawl indexes objects in prefix packages and their subpackages only', async () => {
  const { read } = readerFor(defaultTreeSpec());
  const result = await crawlDestination(read, { rootUri: ROOT, packagePrefixes: ['Z', 'Y'] });
  const names = result.entries.map((e) => `${e.name}:${e.type}:${e.package}`).sort();
  assert.deepEqual(names, ['ZCL_DEMO_JOB:CLAS:ZDEMO', 'ZIF_DEMO:INTF:YTOOLS', 'ZI_DEMO_VIEW:DDLS:ZDEMO']);
  assert.equal(result.entries.find((e) => e.name === 'ZCL_DEMO_JOB').uri, CLASS_FOLDER);
  assert.equal(result.packagesScanned, 3); // ZDEMO_ROOT, ZDEMO, YTOOLS
  assert.equal(result.truncated, false);
  assert.equal(result.cancelled, false);
});

test('crawl with explicit packages ignores the prefixes', async () => {
  const { read } = readerFor(defaultTreeSpec());
  const result = await crawlDestination(read, { rootUri: ROOT, packagePrefixes: ['Z'], packages: ['ytools'] });
  assert.deepEqual(result.entries.map((e) => e.name), ['ZIF_DEMO']);
});

test('crawl falls back to the root when there is no System Library folder', async () => {
  const { read } = readerFor(defaultTreeSpec()['System Library']);
  const result = await crawlDestination(read, { rootUri: ROOT, packagePrefixes: ['Y'] });
  assert.deepEqual(result.entries.map((e) => e.name), ['ZIF_DEMO']);
});

test('crawl stops at maxEntries and reports truncated', async () => {
  const classes = {};
  for (let i = 0; i < 30; i++) classes[`ZCL_N${i}`] = { [`zcl_n${i}.clas.abap`]: '' };
  const { read } = readerFor({ 'System Library': { ZBIG: { Classes: classes } } });
  const result = await crawlDestination(read, { rootUri: ROOT, packagePrefixes: ['Z'], maxEntries: 10 });
  assert.equal(result.entries.length, 10);
  assert.equal(result.truncated, true);
});

test('crawl stops when cancelled', async () => {
  const { read, reads } = readerFor(defaultTreeSpec());
  let calls = 0;
  const result = await crawlDestination(read, {
    rootUri: ROOT,
    packagePrefixes: ['Z', 'Y'],
    concurrency: 1,
    isCancelled: () => ++calls > 2,
  });
  assert.equal(result.cancelled, true);
  assert.ok(reads.length < 8, `read ${reads.length} folders after cancel`);
});

test('crawl skips a folder that fails to read and goes on', async () => {
  const tree = buildTree(defaultTreeSpec());
  const read = async (uri) => {
    if (uri.endsWith('/YTOOLS')) throw new Error('403');
    return tree.folders.get(uri);
  };
  const result = await crawlDestination(read, { rootUri: ROOT, packagePrefixes: ['Z', 'Y'] });
  assert.deepEqual(result.entries.map((e) => e.name).sort(), ['ZCL_DEMO_JOB', 'ZI_DEMO_VIEW']);
});

test('crawl propagates a failure to read the root', async () => {
  await assert.rejects(
    crawlDestination(async () => { throw new Error('offline'); }, { rootUri: ROOT, packagePrefixes: ['Z'] }),
    /offline/
  );
});

test('wildcardToRegExp: * anchors, no * means substring, case-insensitive', () => {
  assert.equal(wildcardToRegExp('ZCL_DEMO*').test('ZCL_DEMO_JOB'), true);
  assert.equal(wildcardToRegExp('ZCL_DEMO*').test('XZCL_DEMO_JOB'), false);
  assert.equal(wildcardToRegExp('demo_job').test('ZCL_DEMO_JOB'), true);
  assert.equal(wildcardToRegExp('*JOB').test('ZCL_DEMO_JOB'), true);
  assert.equal(wildcardToRegExp('ZCL.DEMO').test('ZCLXDEMO'), false);
});

const entries = [
  { name: 'ZCL_DEMO_JOB', type: 'CLAS', package: 'ZDEMO', uri: 'abap:/repotree-v1/DEV_SYS/a' },
  { name: 'ZCL_DEMO_JOB_HELPER', type: 'CLAS', package: 'ZDEMO', uri: 'abap:/repotree-v1/DEV_SYS/b' },
  { name: 'ZI_DEMO_JOB', type: 'DDLS', package: 'ZDEMO', uri: 'abap:/repotree-v1/DEV_SYS/c' },
];

test('search ranks the exact name first and filters by type', async () => {
  const index = new ObjectIndex(createMemoryIndexStore({ DEV_SYS: entries }));
  await index.ensureLoaded('DEV_SYS');
  const hits = index.search({ pattern: 'demo_job', destinations: ['DEV_SYS'], maxResults: 10 });
  assert.deepEqual(hits.map((h) => h.name), ['ZI_DEMO_JOB', 'ZCL_DEMO_JOB', 'ZCL_DEMO_JOB_HELPER']);
  const exact = index.search({ pattern: 'zcl_demo_job', destinations: ['DEV_SYS'], maxResults: 10 });
  assert.equal(exact[0].name, 'ZCL_DEMO_JOB');
  assert.equal(exact[0].destination, 'DEV_SYS');
  const typed = index.search({ pattern: '*', destinations: ['DEV_SYS'], type: 'ddls', maxResults: 10 });
  assert.deepEqual(typed.map((h) => h.name), ['ZI_DEMO_JOB']);
  assert.equal(index.search({ pattern: '*', destinations: ['DEV_SYS'], maxResults: 2 }).length, 2);
});

test('findExact matches name and optional type case-insensitively', async () => {
  const index = new ObjectIndex(createMemoryIndexStore({ DEV_SYS: entries }));
  await index.ensureLoaded('DEV_SYS');
  assert.equal(index.findExact('DEV_SYS', 'zcl_demo_job').uri, 'abap:/repotree-v1/DEV_SYS/a');
  assert.equal(index.findExact('DEV_SYS', 'ZI_DEMO_JOB', 'clas'), undefined);
  assert.equal(index.findExact('OTHER', 'ZCL_DEMO_JOB'), undefined);
});

test('merge persists, keeps a known package, and removeUri drops stale entries', async () => {
  const store = createMemoryIndexStore({ DEV_SYS: entries });
  const index = new ObjectIndex(store);
  await index.merge('DEV_SYS', [{ name: 'ZCL_DEMO_JOB', type: 'CLAS', package: '', uri: 'abap:/repotree-v1/DEV_SYS/a' }]);
  assert.equal(index.findExact('DEV_SYS', 'ZCL_DEMO_JOB').package, 'ZDEMO');
  assert.equal(index.size('DEV_SYS'), 3);
  await index.removeUri('DEV_SYS', 'abap:/repotree-v1/DEV_SYS/a');
  assert.equal(index.size('DEV_SYS'), 2);
  assert.equal(store.data.get('DEV_SYS').length, 2);
});

test('a store that fails to load yields an empty index instead of an error', async () => {
  const index = new ObjectIndex({ load: async () => { throw new Error('corrupt'); }, save: async () => {} });
  await index.ensureLoaded('DEV_SYS');
  assert.equal(index.size('DEV_SYS'), 0);
});

test('file index store round-trips and ignores corrupt files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-index-'));
  try {
    const store = createFileIndexStore(dir);
    assert.equal(await store.load('DEV_SYS'), undefined);
    await store.save('DEV_SYS', entries);
    assert.deepEqual(await store.load('DEV_SYS'), entries);
    fs.writeFileSync(path.join(dir, indexFileName('BROKEN')), '{not json');
    assert.equal(await store.load('BROKEN'), undefined);
    assert.equal(indexFileName('A/B:C'), 'A_B_C.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
