import { classifyFile } from './abapUri';
import { DirEntry, IndexEntry } from './types';

// Name -> abap:// URI index per destination. SAP's own quick search is
// private to its extension, so abap-mirror crawls the customer packages
// once (on demand) and searches this index instead.

export type DirectoryReader = (uri: string) => Promise<DirEntry[]>;

export interface CrawlOptions {
  rootUri: string;
  /** Top-level packages whose name starts with one of these (case-insensitive) are crawled. */
  packagePrefixes: string[];
  /** If given, only these top-level packages (exact, case-insensitive) are crawled instead. */
  packages?: string[];
  maxEntries?: number;
  concurrency?: number;
  maxDepth?: number;
  isCancelled?: () => boolean;
}

export interface CrawlResult {
  entries: IndexEntry[];
  packagesScanned: number;
  truncated: boolean;
  cancelled: boolean;
}

export const DEFAULT_MAX_ENTRIES = 50000;
const SYSTEM_LIBRARY = 'system library';

interface CrawlItem {
  uri: string;
  name: string;
  depth: number;
  parentPackage: string;
}

// Package names are upper case (Z..., Y..., $TMP, namespaces); grouping
// folders such as "Source Code Library" or "Classes" are not.
function looksLikePackage(name: string): boolean {
  return /^[A-Z0-9_$/]+$/.test(name);
}

function isSelectedTopLevel(name: string, options: CrawlOptions): boolean {
  const upper = name.toUpperCase();
  if (options.packages && options.packages.length > 0) {
    return options.packages.some((p) => p.toUpperCase() === upper);
  }
  return options.packagePrefixes.some((prefix) => prefix.length > 0 && upper.startsWith(prefix.toUpperCase()));
}

export async function crawlDestination(read: DirectoryReader, options: CrawlOptions): Promise<CrawlResult> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const concurrency = options.concurrency ?? 4;
  const maxDepth = options.maxDepth ?? 12;
  const isCancelled = options.isCancelled ?? (() => false);

  const rootChildren = await read(options.rootUri);
  const library = rootChildren.find((c) => c.kind === 'folder' && c.name.toLowerCase() === SYSTEM_LIBRARY);
  const topLevel = library ? await read(library.uri) : rootChildren;

  const pending: CrawlItem[] = topLevel
    .filter((c) => c.kind === 'folder' && isSelectedTopLevel(c.name, options))
    .map((c) => ({ uri: c.uri, name: c.name, depth: 0, parentPackage: c.name }));

  const found = new Map<string, IndexEntry>();
  let packagesScanned = 0;
  let truncated = false;
  let cancelled = false;

  const processItem = async (item: CrawlItem): Promise<void> => {
    const children = await read(item.uri);
    const objectKeys = new Map<string, { name: string; type: string }>();
    for (const child of children) {
      if (child.kind !== 'file') continue;
      const c = classifyFile(child.name);
      if (c) objectKeys.set(`${c.name}|${c.type}`, { name: c.name, type: c.type });
    }
    const isObjectFolder = objectKeys.size > 0;
    const isPackage = !isObjectFolder && (item.depth === 0 || looksLikePackage(item.name));
    if (isPackage) packagesScanned++;
    const currentPackage = isPackage ? item.name : item.parentPackage;

    for (const { name, type } of objectKeys.values()) {
      if (found.size >= maxEntries) {
        truncated = true;
        return;
      }
      found.set(`${name}|${type}|${item.uri}`, { name, type, package: currentPackage, uri: item.uri });
    }
    if (item.depth >= maxDepth) return;
    for (const child of children) {
      if (child.kind === 'folder') {
        pending.push({ uri: child.uri, name: child.name, depth: item.depth + 1, parentPackage: currentPackage });
      }
    }
  };

  await new Promise<void>((resolve) => {
    let active = 0;
    const pump = (): void => {
      if (!truncated && !cancelled && isCancelled()) cancelled = true;
      const stopping = truncated || cancelled;
      while (!stopping && active < concurrency && pending.length > 0) {
        const item = pending.shift() as CrawlItem;
        active++;
        processItem(item)
          .catch(() => undefined) // an unreadable folder is skipped, the crawl goes on
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0 && (stopping || pending.length === 0)) resolve();
    };
    pump();
  });

  return { entries: [...found.values()], packagesScanned, truncated, cancelled };
}

export interface IndexStore {
  load(destination: string): Promise<IndexEntry[] | undefined>;
  save(destination: string, entries: IndexEntry[]): Promise<void>;
}

export interface SearchQuery {
  pattern: string;
  destinations: string[];
  type?: string;
  maxResults: number;
}

export interface SearchHit extends IndexEntry {
  destination: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "*" matches anything and anchors the pattern; without "*" it is a substring match. Case-insensitive. */
export function wildcardToRegExp(pattern: string): RegExp {
  const trimmed = pattern.trim();
  const body = trimmed.split('*').map(escapeRegExp).join('.*');
  return new RegExp(trimmed.includes('*') ? `^${body}$` : body, 'i');
}

export class ObjectIndex {
  private readonly byDestination = new Map<string, Map<string, IndexEntry>>();

  constructor(private readonly store: IndexStore) {}

  async ensureLoaded(destination: string): Promise<void> {
    if (this.byDestination.has(destination)) return;
    let loaded: IndexEntry[] | undefined;
    try {
      loaded = await this.store.load(destination);
    } catch {
      loaded = undefined;
    }
    if (this.byDestination.has(destination)) return; // loaded concurrently
    this.byDestination.set(destination, new Map((loaded ?? []).map((e) => [e.uri + '|' + e.name, e])));
  }

  size(destination?: string): number {
    if (destination !== undefined) return this.byDestination.get(destination)?.size ?? 0;
    let total = 0;
    for (const entries of this.byDestination.values()) total += entries.size;
    return total;
  }

  search(query: SearchQuery): SearchHit[] {
    const regex = wildcardToRegExp(query.pattern);
    const exact = query.pattern.trim().toUpperCase();
    const type = query.type?.toUpperCase();
    const hits: SearchHit[] = [];
    for (const destination of query.destinations) {
      for (const entry of this.byDestination.get(destination)?.values() ?? []) {
        if (type && entry.type !== type) continue;
        if (regex.test(entry.name)) hits.push({ ...entry, destination });
      }
    }
    hits.sort((a, b) => {
      const ea = a.name === exact ? 0 : 1;
      const eb = b.name === exact ? 0 : 1;
      return ea - eb || a.name.length - b.name.length || a.name.localeCompare(b.name);
    });
    return hits.slice(0, query.maxResults);
  }

  findExact(destination: string, name: string, type?: string): IndexEntry | undefined {
    const upperName = name.toUpperCase();
    const upperType = type?.toUpperCase();
    for (const entry of this.byDestination.get(destination)?.values() ?? []) {
      if (entry.name === upperName && (!upperType || entry.type === upperType)) return entry;
    }
    return undefined;
  }

  async replace(destination: string, entries: IndexEntry[]): Promise<void> {
    this.byDestination.set(destination, new Map(entries.map((e) => [e.uri + '|' + e.name, e])));
    await this.persist(destination);
  }

  async merge(destination: string, entries: IndexEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureLoaded(destination);
    const map = this.byDestination.get(destination) as Map<string, IndexEntry>;
    for (const e of entries) {
      const key = e.uri + '|' + e.name;
      const previous = map.get(key);
      // Where-used and interactive hits do not know the package; keep the crawled one.
      map.set(key, previous && !e.package ? { ...e, package: previous.package } : e);
    }
    await this.persist(destination);
  }

  async removeUri(destination: string, uri: string): Promise<void> {
    const map = this.byDestination.get(destination);
    if (!map) return;
    let changed = false;
    for (const [key, entry] of map) {
      if (entry.uri === uri) {
        map.delete(key);
        changed = true;
      }
    }
    if (changed) await this.persist(destination);
  }

  private async persist(destination: string): Promise<void> {
    const map = this.byDestination.get(destination);
    if (map) await this.store.save(destination, [...map.values()]);
  }
}
