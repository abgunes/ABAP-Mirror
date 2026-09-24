const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { adtLogPathFor, parseAdtLogErrors, createAdtLogReader } = require('../out/mcp/adtLog');

// Eclipse log timestamps are local time, like the ones ADT writes.
function stamp(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`
  );
}

function entry(date, message, { plugin = 'com.sap.adt.ls', severity = 4 } = {}) {
  return [
    `!ENTRY ${plugin} ${severity} 0 ${stamp(date)}`,
    `!MESSAGE ${message}`,
    '!STACK 0',
    `com.sap.adt.ls.internal.AdtLsFileLockException: ${message}`,
    '\tat com.sap.adt.ls.internal.filesystem.Demo.run(Demo.java:1)',
    '',
  ].join('\n');
}

const LOCKED = 'Object cannot be locked: User DEMO_USER is currently editing ZCL_DEMO_JOB';

test('adtLogPathFor points at ADT\'s Eclipse log next to our storage folder', () => {
  const own = path.join('ws', 'abc123', 'abgunes.abap-mirror');
  assert.equal(adtLogPathFor(own), path.join('ws', 'abc123', 'SAPSE.adt-vscode', 'adtWorkspace', '.metadata', '.log'));
});

test('parseAdtLogErrors returns only SAP errors logged since the given time, deduplicated', () => {
  const since = new Date(2026, 0, 31, 23, 16, 18, 0);
  const text = [
    '!SESSION 2026-01-31 23:00:00.000 ----',
    entry(new Date(since.getTime() - 5000), 'an older failure'),
    entry(new Date(since.getTime() + 300), LOCKED),
    entry(new Date(since.getTime() + 600), LOCKED),
    entry(new Date(since.getTime() + 700), 'just a warning', { severity: 2 }),
    entry(new Date(since.getTime() + 800), 'not from ADT', { plugin: 'org.eclipse.core' }),
  ].join('\n');
  assert.deepEqual(parseAdtLogErrors(text, since.getTime()), [LOCKED]);
});

test('parseAdtLogErrors joins a message that spans several lines and handles CRLF', () => {
  const since = Date.now() - 1000;
  const text = [`!ENTRY com.sap.adt.ls 4 0 ${stamp(new Date())}`, '!MESSAGE first line', 'second line', '!STACK 0', ''].join('\r\n');
  assert.deepEqual(parseAdtLogErrors(text, since), ['first line second line']);
});

test('createAdtLogReader finds an entry that ADT writes shortly after the failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adtlog-'));
  const file = path.join(dir, '.log');
  fs.writeFileSync(file, entry(new Date(Date.now() - 60_000), 'an older failure'));
  const since = Date.now();
  setTimeout(() => fs.appendFileSync(file, entry(new Date(), LOCKED)), 200);
  try {
    assert.deepEqual(await createAdtLogReader(file, 50).errorsSince(since, 2000), [LOCKED]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createAdtLogReader gives up quietly with no path, a missing file, or no new errors', async () => {
  assert.deepEqual(await createAdtLogReader(undefined).errorsSince(0, 100), []);
  assert.deepEqual(await createAdtLogReader(path.join(os.tmpdir(), 'no-such-dir', '.log'), 20).errorsSince(0, 60), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adtlog-'));
  const file = path.join(dir, '.log');
  fs.writeFileSync(file, entry(new Date(Date.now() - 60_000), 'an older failure'));
  try {
    assert.deepEqual(await createAdtLogReader(file, 20).errorsSince(Date.now(), 60), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createAdtLogReader reads only the tail of a large log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adtlog-'));
  const file = path.join(dir, '.log');
  const since = Date.now() - 1000;
  fs.writeFileSync(file, 'x'.repeat(200 * 1024) + '\n' + entry(new Date(), LOCKED));
  try {
    assert.deepEqual(await createAdtLogReader(file, 20).errorsSince(since, 60), [LOCKED]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
