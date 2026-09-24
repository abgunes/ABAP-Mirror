const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { adtCommLogPathFor, parseLockStatus, createAdtCommReader } = require('../out/mcp/adtCommLog');

// VS Code log timestamps are local time.
function stamp(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`
  );
}

function call(date, status, query, { method = 'POST', destination = 'DEV_SYS', resource = '../oo/classes/zcl_demo' } = {}) {
  return `${stamp(date)} [info] ${destination}   ${method.padEnd(4)} ${status}    82(   22|   59)ms   ${resource}${query}\n`;
}

const LOCK = '?_action=LOCK&accessMode=MODIFY';
const UNLOCK = '?_action=UNLOCK&lockHandle=ABC123';

test('adtCommLogPathFor points at ADT\'s HTTP log next to our log folder', () => {
  const own = path.join('logs', 'window1', 'exthost', 'abgunes.abap-mirror');
  assert.equal(
    adtCommLogPathFor(own),
    path.join('logs', 'window1', 'exthost', 'SAPSE.adt-vscode', 'ADT Communication Log.log')
  );
});

test('parseLockStatus returns the status of the first matching call since the given time', () => {
  const since = new Date(2026, 0, 31, 23, 16, 18, 0);
  const at = (ms) => new Date(since.getTime() + ms);
  const text = [
    call(at(-5000), 200, LOCK),
    call(at(10), 200, '?version=workingArea', { method: 'GET' }),
    call(at(20), 403, LOCK, { destination: 'OTHER_SYS' }),
    call(at(30), 200, UNLOCK),
    call(at(40), 403, LOCK),
    call(at(50), 200, LOCK),
  ].join('');
  assert.equal(parseLockStatus(text, 'LOCK', 'dev_sys', 'ZCL_DEMO', since.getTime()), 403);
  assert.equal(parseLockStatus(text, 'UNLOCK', 'DEV_SYS', 'ZCL_DEMO', since.getTime()), 200);
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', 'ZCL_DEMO', at(1000).getTime()), undefined);
});

test('parseLockStatus does not mistake a save carrying a lock handle for a lock call', () => {
  const now = new Date();
  const text = call(now, 200, '/source/main?lockHandle=ABC123', { method: 'PUT' }).replace(/\n/, '\r\n');
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', 'ZCL_DEMO', now.getTime() - 1000), undefined);
});

test('createAdtCommReader finds a call logged shortly after the command', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adtcomm-'));
  const file = path.join(dir, 'ADT Communication Log.log');
  fs.writeFileSync(file, call(new Date(Date.now() - 60_000), 200, LOCK));
  const since = Date.now();
  setTimeout(() => fs.appendFileSync(file, call(new Date(), 403, LOCK)), 200);
  try {
    assert.equal(await createAdtCommReader(file, 50).lockStatusSince('LOCK', 'DEV_SYS', 'ZCL_DEMO', since, 2000), 403);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createAdtCommReader gives up quietly with no path, a missing file, or no call', async () => {
  assert.equal(await createAdtCommReader(undefined).lockStatusSince('LOCK', 'DEV_SYS', 'ZCL_DEMO', 0, 100), undefined);
  const missing = path.join(os.tmpdir(), 'no-such-dir', 'x.log');
  assert.equal(await createAdtCommReader(missing, 20).lockStatusSince('LOCK', 'DEV_SYS', 'ZCL_DEMO', 0, 60), undefined);
});

test('parseLockStatus only takes the call for the requested object', () => {
  const since = new Date(2026, 0, 31, 23, 16, 18, 0);
  const at = (ms) => new Date(since.getTime() + ms);
  const text = [
    call(at(10), 403, LOCK, { resource: '../programs/programs/zdemo_report' }),
    call(at(20), 200, LOCK),
  ].join('');
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', 'ZCL_DEMO', since.getTime()), 200);
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', 'ZDEMO_REPORT', since.getTime()), 403);
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', 'ZCL_OTHER', since.getTime()), undefined);
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', undefined, since.getTime()), 403);
});

test('parseLockStatus matches namespaced objects logged URL-encoded', () => {
  const now = new Date();
  const text = call(now, 200, LOCK, { resource: '../oo/classes/%2fdemo%2fcl_job' });
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', '#DEMO#CL_JOB', now.getTime() - 1000), 200);
  assert.equal(parseLockStatus(text, 'LOCK', 'DEV_SYS', '/DEMO/CL_JOB', now.getTime() - 1000), 200);
});
