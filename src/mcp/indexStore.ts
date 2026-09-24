import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { IndexStore } from './objectIndex';
import { indexEntrySchema } from './schemas';
import { IndexEntry } from './types';

// Persists one JSON file per destination, e.g. <globalStorage>/mcp-index/<DESTINATION>.json.

const indexFileSchema = z.object({
  version: z.literal(1),
  destination: z.string(),
  savedAt: z.string(),
  entries: z.array(indexEntrySchema),
});

export function indexFileName(destination: string): string {
  return destination.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json';
}

export function createFileIndexStore(directory: string): IndexStore {
  let writeSequence = 0;
  return {
    async load(destination: string): Promise<IndexEntry[] | undefined> {
      let text: string;
      try {
        text = await fs.readFile(path.join(directory, indexFileName(destination)), 'utf8');
      } catch {
        return undefined;
      }
      try {
        const parsed = indexFileSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data.entries : undefined;
      } catch {
        return undefined;
      }
    },
    async save(destination: string, entries: IndexEntry[]): Promise<void> {
      await fs.mkdir(directory, { recursive: true });
      const target = path.join(directory, indexFileName(destination));
      const temporary = `${target}.${process.pid}.${++writeSequence}.tmp`;
      const body = JSON.stringify({ version: 1, destination, savedAt: new Date().toISOString(), entries });
      await fs.writeFile(temporary, body, 'utf8');
      await fs.rename(temporary, target);
    },
  };
}
