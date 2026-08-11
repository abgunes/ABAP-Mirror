export const DEFAULT_CONFIRM_THRESHOLD = 200;
export const DEFAULT_READ_CONCURRENCY = 5;

export interface FsLike<TUri, TFileType> {
  readDirectory(uri: TUri): Promise<[string, TFileType][]>;
}

export async function collectLeaves<TUri, TFileType>(
  fsLike: FsLike<TUri, TFileType>,
  directoryFileType: TFileType,
  rootUri: TUri,
  joinChild: (parent: TUri, name: string) => TUri,
  onError?: (uri: TUri, error: Error) => void,
  onLeaf?: (uri: TUri) => void,
  isCancelled?: () => boolean
): Promise<TUri[]> {
  const leaves: TUri[] = [];

  async function walk(uri: TUri): Promise<void> {
    if (isCancelled && isCancelled()) return;
    let entries: [string, TFileType][];
    try {
      entries = await fsLike.readDirectory(uri);
    } catch (e) {
      if (onError) onError(uri, e as Error);
      return;
    }
    for (const [name, type] of entries) {
      const childUri = joinChild(uri, name);
      if (type === directoryFileType) {
        await walk(childUri);
      } else {
        leaves.push(childUri);
        if (onLeaf) onLeaf(childUri);
      }
    }
  }

  await walk(rootUri);
  return leaves;
}

export function shouldConfirm(count: number, threshold: number = DEFAULT_CONFIRM_THRESHOLD): boolean {
  return count > threshold;
}

export interface ConcurrencyOptions {
  concurrency?: number;
  isCancelled?: () => boolean;
}

export async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  { concurrency = DEFAULT_READ_CONCURRENCY, isCancelled = () => false }: ConcurrencyOptions = {}
): Promise<void> {
  let index = 0;

  async function next(): Promise<void> {
    while (index < items.length) {
      if (isCancelled()) return;
      const i = index++;
      await worker(items[i], i);
    }
  }

  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) runners.push(next());
  await Promise.all(runners);
}
