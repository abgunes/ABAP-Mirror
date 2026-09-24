import { TimeoutError } from './types';

export interface TaskQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
}

// Runs at most `concurrency` tasks at once, started in FIFO order.
// A failing task frees its slot the same way a succeeding one does.
export function createTaskQueue(concurrency: number): TaskQueue {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }
  let running = 0;
  const waiting: Array<() => void> = [];

  const next = (): void => {
    if (running >= concurrency) return;
    const start = waiting.shift();
    if (start) start();
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          running++;
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              running--;
              next();
            });
        });
        next();
      });
    },
  };
}

// Rejects with a TimeoutError after `ms`. The wrapped operation is not
// cancelled (VS Code/SAP give us no way to), only no longer awaited.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
