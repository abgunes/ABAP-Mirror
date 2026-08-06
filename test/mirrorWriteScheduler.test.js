const test = require('node:test');
const assert = require('node:assert/strict');
const { createMirrorWriteScheduler } = require('../out/mirrorWriteScheduler');

// Deterministic fake timer so tests never depend on wall-clock timing.
function makeFakeTimers() {
  let seq = 0;
  const timers = new Map();
  return {
    scheduler: {
      set(fn) { const id = ++seq; timers.set(id, fn); return id; },
      clear(id) { timers.delete(id); },
    },
    tick() {
      const fns = Array.from(timers.values());
      timers.clear();
      for (const fn of fns) fn();
    },
    pendingCount() { return timers.size; },
  };
}

test('coalesces a burst of writes for one key into a single latest-content write', () => {
  const writes = [];
  const timers = makeFakeTimers();
  const s = createMirrorWriteScheduler((k, c) => writes.push([k, c]), 150, timers.scheduler);

  s.schedule('a', '1');
  s.schedule('a', '2');
  s.schedule('a', '3');
  assert.equal(writes.length, 0, 'nothing written before the timer fires');

  timers.tick();
  assert.deepEqual(writes, [['a', '3']]);
});

test('keeps different keys independent', () => {
  const writes = [];
  const timers = makeFakeTimers();
  const s = createMirrorWriteScheduler((k, c) => writes.push([k, c]), 150, timers.scheduler);

  s.schedule('a', 'x');
  s.schedule('b', 'y');
  timers.tick();
  assert.deepEqual(writes.sort(), [['a', 'x'], ['b', 'y']]);
});

test('flush writes pending content immediately and cancels the timer', () => {
  const writes = [];
  const timers = makeFakeTimers();
  const s = createMirrorWriteScheduler((k, c) => writes.push([k, c]), 150, timers.scheduler);

  s.schedule('a', '1');
  s.flush('a');
  assert.deepEqual(writes, [['a', '1']]);

  timers.tick(); // the timer for 'a' must have been cancelled
  assert.deepEqual(writes, [['a', '1']]);
});

test('flush on a key with nothing pending is a no-op', () => {
  const writes = [];
  const timers = makeFakeTimers();
  const s = createMirrorWriteScheduler((k, c) => writes.push([k, c]), 150, timers.scheduler);
  s.flush('missing');
  assert.equal(writes.length, 0);
});

test('dispose flushes every pending key', () => {
  const writes = [];
  const timers = makeFakeTimers();
  const s = createMirrorWriteScheduler((k, c) => writes.push([k, c]), 150, timers.scheduler);

  s.schedule('a', '1');
  s.schedule('b', '2');
  s.dispose();
  assert.deepEqual(writes.sort(), [['a', '1'], ['b', '2']]);
  assert.equal(timers.pendingCount(), 0);
});
