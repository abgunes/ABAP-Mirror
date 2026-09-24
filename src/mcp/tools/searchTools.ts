import { z } from 'zod';
import { classifyFile, destinationOf, lastSegment, parentUri } from '../abapUri';
import { crawlDestination } from '../objectIndex';
import { indexEntrySchema } from '../schemas';
import { withTimeout } from '../taskQueue';
import { IndexEntry, TimeoutError, ToolError } from '../types';
import { listFolder, requireSystems } from './common';
import { defineTool, ToolDeps } from './toolDefinition';

const objectTypeSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{2,10}$/)
  .describe('ABAP object type, e.g. CLAS, INTF, DDLS, PROG, FUGR.');

export interface RebuildResult {
  destination: string;
  indexed: number;
  packagesScanned: number;
  durationMs: number;
  truncated: boolean;
  cancelled: boolean;
}

// Shared by the abap_refresh_index tool and the "Rebuild MCP Object Index" command.
export async function rebuildIndex(
  deps: ToolDeps,
  destination: string,
  packages?: string[],
  isCancelled?: () => boolean
): Promise<RebuildResult> {
  const [system] = await requireSystems(deps, destination);
  const prefixes = deps.settings.indexedPackagePrefixes();
  if ((!packages || packages.length === 0) && prefixes.length === 0) {
    throw new ToolError('The setting abapMirror.mcp.indexedPackagePrefixes is empty, so there is nothing to index.');
  }
  const started = Date.now();
  const result = await crawlDestination((uri) => listFolder(deps, uri), {
    rootUri: system.rootUri,
    packagePrefixes: prefixes,
    packages,
    isCancelled: () => deps.isStopping() || (isCancelled ? isCancelled() : false),
  });
  if (packages && packages.length > 0) await deps.index.merge(system.destination, result.entries);
  else await deps.index.replace(system.destination, result.entries);
  return {
    destination: system.destination,
    indexed: result.entries.length,
    packagesScanned: result.packagesScanned,
    durationMs: Date.now() - started,
    truncated: result.truncated,
    cancelled: result.cancelled,
  };
}

export const refreshIndexTool = defineTool({
  name: 'abap_refresh_index',
  title: 'Rebuild the ABAP object index',
  description:
    'Crawls the customer packages (setting abapMirror.mcp.indexedPackagePrefixes, default Z and Y) of one system ' +
    'and rebuilds the name index that abap_search_objects uses. Takes a while on big systems; run it once, ' +
    'then again only when objects were created elsewhere. Pass packages to (re)index only those top-level packages.',
  inputSchema: {
    destination: z.string().min(1).describe('Destination from abap_list_systems.'),
    packages: z.array(z.string().min(1).max(30)).max(50).optional().describe('Top-level package names to index.'),
  },
  outputSchema: {
    destination: z.string(),
    indexed: z.number().int(),
    packagesScanned: z.number().int(),
    durationMs: z.number().int(),
    truncated: z.boolean(),
    cancelled: z.boolean(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async handler(args, deps) {
    return rebuildIndex(deps, args.destination, args.packages);
  },
});

const searchResultSchema = indexEntrySchema.extend({ destination: z.string() });

export const searchObjectsTool = defineTool({
  name: 'abap_search_objects',
  title: 'Search ABAP objects by name',
  description:
    'Finds ABAP objects by name in the abap-mirror object index. "*" is a wildcard (ZCL_DEMO*); without "*" the ' +
    'query matches anywhere in the name; case-insensitive. If nothing is found and interactive is true, the user ' +
    "is asked to pick the object in SAP's Open Object dialog in VS Code (the query is copied to their clipboard).",
  inputSchema: {
    query: z.string().trim().min(1).max(100),
    destination: z.string().min(1).optional().describe('Limit to one system. Required for interactive search when several are connected.'),
    type: objectTypeSchema.optional(),
    maxResults: z.number().int().min(1).max(200).default(50),
    interactive: z.boolean().default(true).describe('Ask the user in VS Code when the index has no match.'),
  },
  outputSchema: {
    results: z.array(searchResultSchema),
    source: z.enum(['index', 'interactive', 'none']),
    indexSize: z.number().int(),
    hint: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, deps) {
    const systems = await requireSystems(deps, args.destination);
    const destinations = systems.map((s) => s.destination);
    for (const d of destinations) await deps.index.ensureLoaded(d);
    const indexSize = destinations.reduce((sum, d) => sum + deps.index.size(d), 0);
    const results = deps.index.search({
      pattern: args.query,
      destinations,
      type: args.type,
      maxResults: args.maxResults,
    });
    if (results.length > 0) return { results, source: 'index' as const, indexSize };

    const emptyHint =
      indexSize === 0 ? 'The object index is empty. Call abap_refresh_index once per system for instant search.' : undefined;
    if (!args.interactive) return { results: [], source: 'none' as const, indexSize, hint: emptyHint };
    if (systems.length > 1) {
      throw new ToolError('Several systems are connected. Pass destination for an interactive search.');
    }

    const destination = systems[0].destination;
    let picked: string | undefined;
    try {
      picked = await deps.uiQueue.run(() =>
        withTimeout(
          deps.bridge.pickObjectInteractively(destination, args.query),
          deps.timeouts.interactive,
          'Interactive search'
        )
      );
    } catch (error) {
      if (!(error instanceof TimeoutError)) throw error;
      picked = undefined;
    }
    if (!picked) {
      return { results: [], source: 'none' as const, indexSize, hint: emptyHint ?? 'Nothing was picked in VS Code.' };
    }

    const pickedDestination = destinationOf(picked) ?? destination;
    const leaf = classifyFile(lastSegment(picked));
    const entry: IndexEntry = leaf
      ? { name: leaf.name, type: leaf.type, package: '', uri: parentUri(picked) }
      : { name: lastSegment(picked).toUpperCase(), type: '', package: '', uri: picked };
    await deps.index.merge(pickedDestination, [entry]);
    return {
      results: [{ ...entry, destination: pickedDestination }],
      source: 'interactive' as const,
      indexSize: deps.index.size(pickedDestination),
    };
  },
});
