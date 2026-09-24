const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { writeSourceTool, activateTool, lockTool, unlockTool } = require('../out/mcp/tools/writeTools');
const { sha256Hex } = require('../out/mcp/hash');
const { StaleSourceError } = require('../out/mcp/types');
const { createDeps, createFakeBridge, CLASS_FOLDER, CLASS_MAIN, CLASS_MAIN_URI } = require('./helpers/mcpFakes');

function call(tool, rawArgs, deps) {
  return tool.handler(z.object(tool.inputSchema).parse(rawArgs), deps);
}

const NEW_SOURCE = CLASS_MAIN.replace('METHODS run.', 'METHODS run.\n    METHODS stop.');
const BASE = sha256Hex(CLASS_MAIN);

test('abap_write_source saves after confirmation and returns the new hash', async () => {
  const { deps, confirmRequests } = createDeps();
  const out = await call(writeSourceTool, { uri: CLASS_MAIN_URI, source: NEW_SOURCE, baseHash: BASE }, deps);
  assert.deepEqual(out, { saved: true, newHash: sha256Hex(NEW_SOURCE), diagnostics: [] });
  assert.deepEqual(deps.bridge.calls.writes, [{ uri: CLASS_MAIN_URI, source: NEW_SOURCE }]);
  assert.equal(confirmRequests.length, 1);
  assert.equal(confirmRequests[0].action, 'write');
  assert.equal(confirmRequests[0].objectLabel, 'ZCL_DEMO_JOB (main)');
  assert.equal(confirmRequests[0].destination, 'DEV_SYS');
  assert.equal(confirmRequests[0].currentSource, CLASS_MAIN);
  assert.equal(confirmRequests[0].proposedSource, NEW_SOURCE);
});

test('abap_write_source refuses a stale baseHash and writes nothing', async () => {
  const { deps, confirmRequests } = createDeps();
  await assert.rejects(
    call(writeSourceTool, { uri: CLASS_MAIN_URI, source: NEW_SOURCE, baseHash: sha256Hex('old') }, deps),
    StaleSourceError
  );
  assert.equal(deps.bridge.calls.writes.length, 0);
  assert.equal(confirmRequests.length, 0);
});

test('abap_write_source writes nothing when the user denies', async () => {
  const { deps } = createDeps({ confirmAnswer: false });
  await assert.rejects(
    call(writeSourceTool, { uri: CLASS_MAIN_URI, source: NEW_SOURCE, baseHash: BASE }, deps),
    /User denied saving ZCL_DEMO_JOB \(main\) in VS Code/
  );
  assert.equal(deps.bridge.calls.writes.length, 0);
});

test('abap_write_source skips the popup when confirmWrites is off', async () => {
  const { deps, confirmRequests } = createDeps({ confirmWrites: false });
  await call(writeSourceTool, { uri: CLASS_MAIN_URI, source: NEW_SOURCE, baseHash: BASE }, deps);
  assert.equal(confirmRequests.length, 0);
  assert.equal(deps.bridge.calls.writes.length, 1);
});

test('abap_write_source with unchanged source does not save or ask', async () => {
  const { deps, confirmRequests } = createDeps();
  const out = await call(writeSourceTool, { uri: CLASS_MAIN_URI, source: CLASS_MAIN, baseHash: BASE }, deps);
  assert.equal(out.saved, false);
  assert.equal(confirmRequests.length, 0);
  assert.equal(deps.bridge.calls.writes.length, 0);
});

test('abap_write_source with activate reports activation from diagnostics', async () => {
  const { deps, confirmRequests } = createDeps();
  deps.bridge.diagnosticsByUri.set(CLASS_MAIN_URI, [{ severity: 'error', line: 3, message: 'Syntax error' }]);
  const out = await call(writeSourceTool, { uri: CLASS_MAIN_URI, source: NEW_SOURCE, baseHash: BASE, activate: true }, deps);
  assert.equal(confirmRequests[0].action, 'write_activate');
  assert.deepEqual(deps.bridge.calls.activations, [CLASS_MAIN_URI]);
  assert.equal(out.saved, true);
  assert.equal(out.activated, false);
  assert.equal(out.diagnostics[0].message, 'Syntax error');
});

test('abap_write_source reports a failed activation without hiding the save', async () => {
  const bridge = createFakeBridge({ activateImpl: async () => { throw new Error('Activation cancelled'); } });
  const { deps } = createDeps({ bridge });
  const out = await call(writeSourceTool, { uri: CLASS_MAIN_URI, source: NEW_SOURCE, baseHash: BASE, activate: true }, deps);
  assert.equal(out.saved, true);
  assert.equal(out.activated, false);
  assert.equal(out.activationError, 'Activation cancelled');
});

test('abap_write_source rejects metadata files and bad hashes', async () => {
  const { deps } = createDeps();
  await assert.rejects(
    call(writeSourceTool, { uri: `${CLASS_FOLDER}/zcl_demo_job.clas.json`, source: '{}', baseHash: BASE }, deps),
    /must be an ABAP source file/
  );
  assert.throws(() => z.object(writeSourceTool.inputSchema).parse({ uri: CLASS_MAIN_URI, source: '', baseHash: 'abc' }));
});

test('two concurrent writes run one after another, the second sees the new hash', async () => {
  const { deps } = createDeps({ confirmWrites: false });
  const first = call(writeSourceTool, { uri: CLASS_MAIN_URI, source: NEW_SOURCE, baseHash: BASE }, deps);
  const second = call(writeSourceTool, { uri: CLASS_MAIN_URI, source: 'other', baseHash: BASE }, deps);
  assert.equal((await first).saved, true);
  await assert.rejects(second, StaleSourceError);
});

test('abap_activate confirms once and activates each object main source', async () => {
  const { deps, confirmRequests } = createDeps();
  const out = await call(activateTool, { uris: [CLASS_FOLDER] }, deps);
  assert.equal(confirmRequests.length, 1);
  assert.equal(confirmRequests[0].action, 'activate');
  assert.deepEqual(deps.bridge.calls.activations, [CLASS_MAIN_URI]);
  assert.deepEqual(out.results, [{ uri: CLASS_FOLDER, activated: true, diagnostics: [] }]);
});

test('abap_activate records a per-object failure and continues', async () => {
  let n = 0;
  const bridge = createFakeBridge({ activateImpl: async () => { if (n++ === 0) throw new Error('locked by OTHER_USER'); } });
  const { deps } = createDeps({ bridge });
  const out = await call(activateTool, { uris: [CLASS_FOLDER, CLASS_MAIN_URI] }, deps);
  assert.equal(out.results[0].activated, false);
  assert.equal(out.results[0].error, 'locked by OTHER_USER');
  assert.equal(out.results[1].activated, true);
});

test('abap_lock and abap_unlock confirm, run on the main source, and report status', async () => {
  const { deps, confirmRequests } = createDeps();
  assert.deepEqual(await call(lockTool, { uri: CLASS_FOLDER }, deps), { requested: true, status: 'unknown' });
  assert.deepEqual(await call(unlockTool, { uri: CLASS_FOLDER }, deps), { requested: true, status: 'unknown' });
  assert.deepEqual(deps.bridge.calls.locks, [CLASS_MAIN_URI]);
  assert.deepEqual(deps.bridge.calls.unlocks, [CLASS_MAIN_URI]);
  assert.deepEqual(confirmRequests.map((r) => r.action), ['lock', 'unlock']);
});

test('abap_lock does nothing when denied', async () => {
  const { deps } = createDeps({ confirmAnswer: false });
  await assert.rejects(call(lockTool, { uri: CLASS_FOLDER }, deps), /User denied locking ZCL_DEMO_JOB/);
  assert.equal(deps.bridge.calls.locks.length, 0);
});
