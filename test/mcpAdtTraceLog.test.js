const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { adtTraceLogPathFor, parseLockReply, createAdtTraceReader } = require('../out/mcp/adtTraceLog');

// VS Code log timestamps are local time.
function stamp(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`
  );
}

function reply(date, method, result, id = 7) {
  const lines = [`${stamp(date)} [trace] Received response 'adtLs/fileSystem/${method} - (${id})' in 81ms.`];
  if (result) lines.push(`Result: ${JSON.stringify(result, null, 4)}`);
  return lines.join('\n') + '\n';
}

const LOCKED = 'User DEMO_USER is currently editing ZCL_DEMO_JOB';
const FAILED = { lockingSupported: true, operationExecuted: true, errorMessage: LOCKED };
const OK = { lockingSupported: true, operationExecuted: true };

test('adtTraceLogPathFor points at ADT\'s trace channel file next to our log folder', () => {
  const own = path.join('logs', 'window1', 'exthost', 'abgunes.abap-mirror');
  assert.equal(adtTraceLogPathFor(own), path.join('logs', 'window1', 'exthost', 'SAPSE.adt-vscode', 'ADT Error Log.log'));
});

test('parseLockReply returns the newest reply to the method since the given time', () => {
  const since = new Date(2026, 0, 31, 23, 16, 18, 0);
  const text = [
    reply(new Date(since.getTime() - 5000), 'lockFile', OK),
    `${stamp(since)} [trace] Received notification 'window/showMessage'.\nParams: {\n    "type": 1,\n    "message": "${LOCKED}"\n}\n`,
    reply(new Date(since.getTime() + 80), 'unlockFile', OK),
    reply(new Date(since.getTime() + 90), 'getFileLockStatus', { locked: false }),
    reply(new Date(since.getTime() + 100), 'lockFile', FAILED),
  ].join('');
  assert.deepEqual(parseLockReply(text, 'lockFile', since.getTime()), FAILED);
  assert.deepEqual(parseLockReply(text, 'unlockFile', since.getTime()), OK);
  assert.equal(parseLockReply(text, 'lockFile', since.getTime() + 1000), undefined);
});

test('parseLockReply ignores replies traced without a Result block and handles CRLF', () => {
  const now = new Date();
  assert.equal(parseLockReply(reply(now, 'lockFile'), 'lockFile', now.getTime() - 1000), undefined);
  const crlf = reply(now, 'lockFile', FAILED).replace(/\n/g, '\r\n');
  assert.deepEqual(parseLockReply(crlf, 'lockFile', now.getTime() - 1000), FAILED);
});

test('createAdtTraceReader finds a reply traced shortly after the command', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adttrace-'));
  const file = path.join(dir, 'ADT Error Log.log');
  fs.writeFileSync(file, reply(new Date(Date.now() - 60_000), 'lockFile', OK));
  const since = Date.now();
  setTimeout(() => fs.appendFileSync(file, reply(new Date(), 'lockFile', FAILED)), 200);
  try {
    assert.deepEqual(await createAdtTraceReader(file, 50).lockReplySince('lockFile', since, 2000), FAILED);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createAdtTraceReader gives up at once when tracing is off', async () => {
  assert.equal(await createAdtTraceReader(undefined).lockReplySince('lockFile', 0, 100), undefined);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adttrace-'));
  const file = path.join(dir, 'ADT Error Log.log');
  fs.writeFileSync(file, `${stamp(new Date())} [error] something unrelated\n`);
  try {
    const started = Date.now();
    assert.equal(await createAdtTraceReader(file, 20).lockReplySince('lockFile', 0, 5000), undefined);
    assert.ok(Date.now() - started < 1000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
