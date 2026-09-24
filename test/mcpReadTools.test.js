const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { listSystemsTool, listFolderTool } = require('../out/mcp/tools/browseTools');
const { searchObjectsTool, refreshIndexTool } = require('../out/mcp/tools/searchTools');
const { readObjectTool, whereUsedTool } = require('../out/mcp/tools/readTools');
const { sha256Hex } = require('../out/mcp/hash');
const { createDeps, createFakeBridge, createMemoryIndexStore, ROOT, CLASS_FOLDER, CLASS_MAIN, CLASS_MAIN_URI, uriOf } = require('./helpers/mcpFakes');

// Parse like the SDK does, so schema defaults (maxResults, interactive, ...) apply.
function call(tool, rawArgs, deps) {
  return tool.handler(z.object(tool.inputSchema).parse(rawArgs), deps);
}

test('abap_list_systems returns the connected systems', async () => {
  const { deps } = createDeps();
  assert.deepEqual(await call(listSystemsTool, {}, deps), { systems: [{ destination: 'DEV_SYS', rootUri: ROOT }] });
});

test('abap_list_systems fails with a clear message when nothing is connected', async () => {
  const bridge = createFakeBridge();
  bridge.systems = [];
  const { deps } = createDeps({ bridge });
  await assert.rejects(call(listSystemsTool, {}, deps), /No ABAP system connected/);
});

test('abap_list_folder lists children and rejects non-abap URIs at the schema', async () => {
  const { deps } = createDeps();
  const out = await call(listFolderTool, { uri: ROOT }, deps);
  assert.deepEqual(out.children.map((c) => c.name), ['System Library']);
  assert.throws(() => z.object(listFolderTool.inputSchema).parse({ uri: 'file:///c:/x' }));
});

test('abap_refresh_index crawls and then search finds objects from the index', async () => {
  const { deps } = createDeps();
  const refreshed = await call(refreshIndexTool, { destination: 'dev_sys' }, deps);
  assert.equal(refreshed.destination, 'DEV_SYS');
  assert.equal(refreshed.indexed, 3);
  const found = await call(searchObjectsTool, { query: 'ZCL_DEMO*' }, deps);
  assert.equal(found.source, 'index');
  assert.deepEqual(found.results, [
    { name: 'ZCL_DEMO_JOB', type: 'CLAS', package: 'ZDEMO', uri: CLASS_FOLDER, destination: 'DEV_SYS' },
  ]);
  assert.equal(deps.bridge.calls.picks.length, 0);
});

test('abap_refresh_index refuses an unknown destination and lists the connected ones', async () => {
  const { deps } = createDeps();
  await assert.rejects(call(refreshIndexTool, { destination: 'PRD' }, deps), /"PRD" is not connected.*DEV_SYS/);
});

test('abap_refresh_index refuses to run with no prefixes and no packages', async () => {
  const { deps } = createDeps({ prefixes: [] });
  await assert.rejects(call(refreshIndexTool, { destination: 'DEV_SYS' }, deps), /indexedPackagePrefixes is empty/);
});

test('search with an empty index and interactive=false returns none with a hint', async () => {
  const { deps } = createDeps();
  const out = await call(searchObjectsTool, { query: 'ZCL_DEMO_JOB', interactive: false }, deps);
  assert.equal(out.source, 'none');
  assert.deepEqual(out.results, []);
  assert.match(out.hint, /abap_refresh_index/);
});

test('search falls back to the interactive picker and indexes the picked object', async () => {
  const bridge = createFakeBridge({ pickResult: CLASS_MAIN_URI });
  const { deps } = createDeps({ bridge });
  const out = await call(searchObjectsTool, { query: 'ZCL_DEMO_JOB' }, deps);
  assert.equal(out.source, 'interactive');
  assert.deepEqual(out.results[0], { name: 'ZCL_DEMO_JOB', type: 'CLAS', package: '', uri: CLASS_FOLDER, destination: 'DEV_SYS' });
  assert.deepEqual(bridge.calls.picks, [{ destination: 'DEV_SYS', query: 'ZCL_DEMO_JOB' }]);
  const again = await call(searchObjectsTool, { query: 'ZCL_DEMO_JOB' }, deps);
  assert.equal(again.source, 'index');
});

test('search returns none when the user cancels or the picker times out', async () => {
  const cancelled = createDeps({ bridge: createFakeBridge({ pickResult: undefined }) });
  assert.equal((await call(searchObjectsTool, { query: 'X' }, cancelled.deps)).source, 'none');
  const slow = createDeps({ bridge: createFakeBridge({ pickResult: () => new Promise(() => {}) }), timeouts: { interactive: 20 } });
  assert.equal((await call(searchObjectsTool, { query: 'X' }, slow.deps)).source, 'none');
});

test('interactive search needs a destination when several systems are connected', async () => {
  const bridge = createFakeBridge();
  bridge.systems = [
    { destination: 'DEV_SYS', rootUri: ROOT },
    { destination: 'QA_SYS', rootUri: 'abap:/repotree-v1/QA_SYS' },
  ];
  const { deps } = createDeps({ bridge });
  await assert.rejects(call(searchObjectsTool, { query: 'X' }, deps), /Pass destination/);
});

test('abap_read_object by file URI returns all source parts in order with hashes', async () => {
  const { deps } = createDeps();
  const out = await call(readObjectTool, { uri: CLASS_MAIN_URI }, deps);
  assert.equal(out.name, 'ZCL_DEMO_JOB');
  assert.equal(out.type, 'CLAS');
  assert.equal(out.destination, 'DEV_SYS');
  assert.equal(out.objectUri, CLASS_FOLDER);
  assert.deepEqual(out.parts.map((p) => p.part), ['main', 'definitions', 'implementations', 'testclasses']);
  assert.equal(out.parts[0].source, CLASS_MAIN);
  assert.equal(out.parts[0].hash, sha256Hex(CLASS_MAIN));
});

test('abap_read_object by folder URI with a parts filter', async () => {
  const { deps } = createDeps();
  const out = await call(readObjectTool, { uri: CLASS_FOLDER, parts: ['implementations'] }, deps);
  assert.deepEqual(out.parts.map((p) => p.part), ['implementations']);
  await assert.rejects(call(readObjectTool, { uri: CLASS_FOLDER, parts: ['macros'] }, deps), /Available parts: main/);
});

test('abap_read_object by name uses the index', async () => {
  const { deps } = createDeps();
  await call(refreshIndexTool, { destination: 'DEV_SYS' }, deps);
  const out = await call(readObjectTool, { destination: 'DEV_SYS', name: 'zi_demo_view' }, deps);
  assert.equal(out.type, 'DDLS');
  assert.deepEqual(out.parts.map((p) => p.part), ['main']);
});

test('abap_read_object by name removes a stale index entry', async () => {
  const stale = { name: 'ZCL_GONE', type: 'CLAS', package: 'ZDEMO', uri: uriOf('System Library', 'ZCL_GONE') };
  const store = createMemoryIndexStore({ DEV_SYS: [stale] });
  const { deps } = createDeps({ store });
  await assert.rejects(call(readObjectTool, { destination: 'DEV_SYS', name: 'ZCL_GONE' }, deps), /stale index entry was removed/);
  assert.equal(deps.index.size('DEV_SYS'), 0);
});

test('abap_read_object explains how to find an object that is not indexed', async () => {
  const { deps } = createDeps();
  await assert.rejects(call(readObjectTool, { destination: 'DEV_SYS', name: 'ZNOPE' }, deps), /abap_search_objects/);
  await assert.rejects(call(readObjectTool, {}, deps), /Pass either uri, or destination and name/);
});

test('abap_where_used asks references at the declaration and indexes the users', async () => {
  const userUri = uriOf('System Library', 'ZDEMO_ROOT', 'ZDEMO', 'Programs', 'ZDEMO_REPORT', 'zdemo_report.prog.abap');
  const bridge = createFakeBridge({
    referencesResult: [
      { uri: CLASS_MAIN_URI, line: 1, snippet: 'CLASS zcl_demo_job DEFINITION PUBLIC FINAL CREATE PUBLIC.' },
      { uri: userUri, line: 12, snippet: '   DATA(job) = NEW zcl_demo_job( ).   ' },
    ],
  });
  const { deps } = createDeps({ bridge });
  const out = await call(whereUsedTool, { uri: CLASS_FOLDER, maxResults: 1 }, deps);
  assert.deepEqual(bridge.calls.references, [{ uri: CLASS_MAIN_URI, line: 0, character: 6 }]);
  assert.equal(out.objectName, 'ZCL_DEMO_JOB');
  assert.equal(out.usages.length, 1);
  assert.equal(out.truncated, true);
  assert.ok(deps.index.findExact('DEV_SYS', 'ZDEMO_REPORT', 'PROG'));
  const all = await call(whereUsedTool, { uri: CLASS_FOLDER }, deps);
  assert.equal(all.usages[1].snippet, 'DATA(job) = NEW zcl_demo_job( ).');
  assert.equal(all.usages[1].objectName, 'ZDEMO_REPORT');
});
