const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskQueue, withTimeout } = require('../out/mcp/taskQueue');
const { TimeoutError, ToolError } = require('../out/mcp/types');
const { sha256Hex } = require('../out/mcp/hash');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('sha256Hex is the hex sha256 of the UTF-8 text', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(sha256Hex('a\r\nb'), sha256Hex('a\nb'));
});

test('a queue of one runs tasks strictly one after another in FIFO order', async () => {
  const queue = createTaskQueue(1);
  const events = [];
  const task = (name, ms) => () =>
    (async () => {
      events.push(`start ${name}`);
      await delay(ms);
      events.push(`end ${name}`);
      return name;
    })();
  const results = await Promise.all([queue.run(task('a', 20)), queue.run(task('b', 1)), queue.run(task('c', 1))]);
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});

test('a queue never runs more than its concurrency at once', async () => {
  const queue = createTaskQueue(2);
  let active = 0;
  let peak = 0;
  const task = () =>
    queue.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await delay(5);
      active--;
    });
  await Promise.all([task(), task(), task(), task(), task()]);
  assert.equal(peak, 2);
});

test('a failing task rejects its caller but does not block the queue', async () => {
  const queue = createTaskQueue(1);
  await assert.rejects(queue.run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await queue.run(async () => 'next'), 'next');
});

test('a task that throws synchronously is still contained', async () => {
  const queue = createTaskQueue(1);
  await assert.rejects(queue.run(() => { throw new Error('sync'); }), /sync/);
  assert.equal(await queue.run(async () => 1), 1);
});

test('createTaskQueue rejects a bad concurrency', () => {
  assert.throws(() => createTaskQueue(0));
  assert.throws(() => createTaskQueue(1.5));
});

test('withTimeout passes the result through when in time', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 100, 'X'), 7);
});

test('withTimeout rejects with a TimeoutError naming the action', async () => {
  const never = new Promise(() => {});
  await assert.rejects(withTimeout(never, 20, 'Save'), (error) => {
    assert.ok(error instanceof TimeoutError);
    assert.ok(error instanceof ToolError);
    assert.match(error.message, /^Save timed out after 0 s/);
    return true;
  });
});

test('a timed-out task frees its queue slot', async () => {
  const queue = createTaskQueue(1);
  await assert.rejects(queue.run(() => withTimeout(new Promise(() => {}), 10, 'Slow')), TimeoutError);
  assert.equal(await queue.run(async () => 'free'), 'free');
});
