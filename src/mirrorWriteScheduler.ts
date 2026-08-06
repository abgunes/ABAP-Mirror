// onDidChangeTextDocument fires for every keystroke in an ADT tab, and the
// current mirror write reads and rewrites the whole file synchronously each
// time. For a large class that is real jank on the extension-host event loop.
// This scheduler collapses a burst of edits for the same mirror path into a
// single write of the latest content after a short quiet period, while flush
// and dispose guarantee no pending edit is lost when focus changes or the
// extension shuts down. The write itself stays synchronous (the existing
// writeMirrorIfChanged); the win here is frequency, not async I/O.
type TimerHandle = ReturnType<typeof setTimeout>;

interface TimerApi {
  set(fn: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
}

export interface MirrorWriteScheduler {
  schedule(key: string, content: string): void;
  flush(key: string): void;
  dispose(): void;
}

const DEFAULT_TIMERS: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle),
};

export function createMirrorWriteScheduler(
  write: (key: string, content: string) => void,
  delayMs = 150,
  timers: TimerApi = DEFAULT_TIMERS
): MirrorWriteScheduler {
  const pending = new Map<string, { content: string; timer: TimerHandle }>();

  function flush(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;
    timers.clear(entry.timer);
    pending.delete(key);
    write(key, entry.content);
  }

  function schedule(key: string, content: string): void {
    const existing = pending.get(key);
    if (existing) timers.clear(existing.timer);
    const timer = timers.set(() => flush(key), delayMs);
    pending.set(key, { content, timer });
  }

  function dispose(): void {
    for (const key of Array.from(pending.keys())) flush(key);
  }

  return { schedule, flush, dispose };
}
