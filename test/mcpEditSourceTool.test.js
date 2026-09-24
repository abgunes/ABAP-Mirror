const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { editSourceTool } = require('../out/mcp/tools/writeTools');
const { sha256Hex } = require('../out/mcp/hash');
const { StaleSourceError } = require('../out/mcp/types');
const { createDeps, CLASS_MAIN, CLASS_MAIN_URI } = require('./helpers/mcpFakes');

function call(tool, rawArgs, deps) {
  return tool.handler(z.object(tool.inputSchema).parse(rawArgs), deps);
}

const BASE = sha256Hex(CLASS_MAIN);

test('abap_edit_source applies one edit and saves the spliced source', async () => {
  const { deps, confirmRequests } = createDeps();
  const out = await call(
    editSourceTool,
    { uri: CLASS_MAIN_URI, baseHash: BASE, edits: [{ oldString: 'METHODS run.', newString: 'METHODS run.\n    METHODS stop.' }] },
    deps
  );
  const expected = CLASS_MAIN.replace('METHODS run.', 'METHODS run.\n    METHODS stop.');
  assert.deepEqual(out, { saved: true, newHash: sha256Hex(expected), diagnostics: [] });
  assert.deepEqual(deps.bridge.calls.writes, [{ uri: CLASS_MAIN_URI, source: expected }]);
  assert.equal(confirmRequests[0].action, 'write');
  assert.equal(confirmRequests[0].currentSource, CLASS_MAIN);
  assert.equal(confirmRequests[0].proposedSource, expected);
});

test('abap_edit_source applies several edits in order, later edits see earlier ones', async () => {
  const { deps } = createDeps();
  const out = await call(
    editSourceTool,
    {
      uri: CLASS_MAIN_URI,
      baseHash: BASE,
      edits: [
        { oldString: 'METHODS run.', newString: 'METHODS run.\n    METHODS stop.' },
        { oldString: 'METHODS stop.', newString: 'METHODS stop2.' },
      ],
    },
    deps
  );
  assert.equal(deps.bridge.calls.writes[0].source.includes('METHODS stop2.'), true);
  assert.equal(out.saved, true);
});

test('abap_edit_source refuses a stale baseHash and writes nothing', async () => {
  const { deps } = createDeps();
  await assert.rejects(
    call(editSourceTool, { uri: CLASS_MAIN_URI, baseHash: sha256Hex('old'), edits: [{ oldString: 'run', newString: 'walk' }] }, deps),
    StaleSourceError
  );
  assert.equal(deps.bridge.calls.writes.length, 0);
});

test('abap_edit_source rejects an oldString that is not found, and writes nothing', async () => {
  const { deps, confirmRequests } = createDeps();
  await assert.rejects(
    call(editSourceTool, { uri: CLASS_MAIN_URI, baseHash: BASE, edits: [{ oldString: 'NOT_PRESENT_TEXT', newString: 'x' }] }, deps),
    /Edit 1 of 1: oldString was not found/
  );
  assert.equal(deps.bridge.calls.writes.length, 0);
  assert.equal(confirmRequests.length, 0);
});

test('abap_edit_source rejects an oldString that matches more than once without replaceAll', async () => {
  const { deps } = createDeps();
  await assert.rejects(
    call(editSourceTool, { uri: CLASS_MAIN_URI, baseHash: BASE, edits: [{ oldString: 'ENDCLASS.', newString: 'X' }] }, deps),
    /Edit 1 of 1: oldString matches 2 times/
  );
  assert.equal(deps.bridge.calls.writes.length, 0);
});

test('abap_edit_source replaceAll replaces every match', async () => {
  const { deps } = createDeps();
  const out = await call(
    editSourceTool,
    { uri: CLASS_MAIN_URI, baseHash: BASE, edits: [{ oldString: 'ENDCLASS.', newString: 'ENDCLASS. "x', replaceAll: true }] },
    deps
  );
  assert.equal(out.saved, true);
  assert.equal(deps.bridge.calls.writes[0].source.split('ENDCLASS. "x').length - 1, 2);
});

test('abap_edit_source writes nothing when a later edit in the batch fails to match', async () => {
  const { deps } = createDeps();
  await assert.rejects(
    call(
      editSourceTool,
      {
        uri: CLASS_MAIN_URI,
        baseHash: BASE,
        edits: [
          { oldString: 'METHODS run.', newString: 'METHODS run.\n    METHODS stop.' },
          { oldString: 'NOT_PRESENT', newString: 'x' },
        ],
      },
      deps
    ),
    /Edit 2 of 2: oldString was not found/
  );
  assert.equal(deps.bridge.calls.writes.length, 0);
});

test('abap_edit_source with a no-op edit and activate confirms activate with no diff', async () => {
  const { deps, confirmRequests } = createDeps();
  const out = await call(
    editSourceTool,
    { uri: CLASS_MAIN_URI, baseHash: BASE, edits: [{ oldString: 'METHODS run.', newString: 'METHODS run.' }], activate: true },
    deps
  );
  assert.equal(confirmRequests.length, 1);
  assert.equal(confirmRequests[0].action, 'activate');
  assert.equal(confirmRequests[0].currentSource, undefined);
  assert.equal(confirmRequests[0].proposedSource, undefined);
  assert.equal(out.saved, false);
  assert.deepEqual(deps.bridge.calls.writes, []);
  assert.deepEqual(deps.bridge.calls.activations, [CLASS_MAIN_URI]);
  assert.equal(out.activated, true);
});

test('abap_edit_source writes nothing when the user denies', async () => {
  const { deps } = createDeps({ confirmAnswer: false });
  await assert.rejects(
    call(editSourceTool, { uri: CLASS_MAIN_URI, baseHash: BASE, edits: [{ oldString: 'METHODS run.', newString: 'METHODS run2.' }] }, deps),
    /User denied saving ZCL_DEMO_JOB \(main\) in VS Code/
  );
  assert.equal(deps.bridge.calls.writes.length, 0);
});

test('abap_edit_source input schema rejects an empty edits array and an empty oldString', () => {
  assert.throws(() => z.object(editSourceTool.inputSchema).parse({ uri: CLASS_MAIN_URI, baseHash: BASE, edits: [] }));
  assert.throws(() =>
    z.object(editSourceTool.inputSchema).parse({ uri: CLASS_MAIN_URI, baseHash: BASE, edits: [{ oldString: '', newString: 'x' }] })
  );
});
