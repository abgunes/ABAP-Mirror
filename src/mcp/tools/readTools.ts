import { z } from 'zod';
import { classifyFile, destinationOf, lastSegment, parentUri } from '../abapUri';
import { sha256Hex } from '../hash';
import { findIdentifierPosition } from '../identifierPosition';
import { abapUriSchema, diagnosticSchema, sourcePartSchema } from '../schemas';
import { withTimeout } from '../taskQueue';
import { IndexEntry, NotFoundError, ToolError } from '../types';
import { mainSourceOf, readSource, requireSystems, resolveObject, ResolvedObject } from './common';
import { defineTool } from './toolDefinition';

export const readObjectTool = defineTool({
  name: 'abap_read_object',
  title: 'Read ABAP object source',
  description:
    'Returns the source of an ABAP object, all parts in one call (for classes: main, definitions, implementations, ' +
    'macros, testclasses). Each part has a hash; pass it as baseHash to abap_write_source. Identify the object by ' +
    'uri (object folder or any of its files), or by destination + name when it is in the index.',
  inputSchema: {
    uri: abapUriSchema.optional(),
    destination: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    type: z.string().regex(/^[A-Za-z0-9]{2,10}$/).optional(),
    parts: z.array(sourcePartSchema).min(1).optional().describe('Only return these parts. Default: every source part.'),
  },
  outputSchema: {
    name: z.string(),
    type: z.string(),
    destination: z.string(),
    objectUri: z.string(),
    parts: z.array(z.object({ part: sourcePartSchema, uri: z.string(), source: z.string(), hash: z.string() })),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, deps) {
    let object: ResolvedObject;
    if (args.uri) {
      object = await resolveObject(deps, args.uri);
    } else if (args.name) {
      const systems = await requireSystems(deps, args.destination);
      if (systems.length > 1) throw new ToolError('Several systems are connected. Pass destination.');
      const destination = systems[0].destination;
      await deps.index.ensureLoaded(destination);
      const entry = deps.index.findExact(destination, args.name, args.type);
      if (!entry) {
        throw new ToolError(
          `${args.name.toUpperCase()} is not in the object index of ${destination}. ` +
            'Use abap_search_objects (it can ask the user to pick it in VS Code) or abap_refresh_index.'
        );
      }
      try {
        object = await resolveObject(deps, entry.uri);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        await deps.index.removeUri(destination, entry.uri);
        throw new ToolError(
          `${entry.name} no longer exists at its indexed location; the stale index entry was removed. Search again.`
        );
      }
    } else {
      throw new ToolError('Pass either uri, or destination and name.');
    }

    const wanted = args.parts;
    const selected = object.sources.filter((s) => !wanted || wanted.includes(s.classification.part));
    if (selected.length === 0) {
      const available = object.sources.map((s) => s.classification.part).join(', ');
      throw new ToolError(`None of the requested parts exist. Available parts: ${available}.`);
    }
    const parts = await Promise.all(
      selected.map(async (s) => {
        const source = await readSource(deps, s.uri);
        return { part: s.classification.part, uri: s.uri, source, hash: sha256Hex(source) };
      })
    );
    const main = mainSourceOf(object);
    return {
      name: main.classification.name,
      type: main.classification.type,
      destination: object.destination,
      objectUri: object.folderUri,
      parts,
    };
  },
});

export const checkTool = defineTool({
  name: 'abap_check',
  title: 'Check an ABAP object for syntax errors',
  description:
    "Runs SAP's syntax check (ADT's \"Check Object\") on an object and returns its diagnostics, without activating " +
    'it or needing confirmation. Briefly shows the object in an editor tab, because ADT performs the check on the ' +
    'active editor.',
  inputSchema: {
    uri: abapUriSchema.describe('Object folder URI or any of its source files.'),
  },
  outputSchema: {
    diagnostics: z.array(diagnosticSchema),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, deps) {
    const object = await resolveObject(deps, args.uri);
    const main = mainSourceOf(object);
    return deps.uiQueue.run(async () => {
      const diagnostics = await withTimeout(deps.bridge.check(main.uri), deps.timeouts.check, 'Check');
      return { diagnostics };
    });
  },
});

export const whereUsedTool = defineTool({
  name: 'abap_where_used',
  title: 'Find where an ABAP object is used',
  description:
    "Runs SAP's where-used list for an object (via the ADT extension) and returns each usage with its file URI, " +
    '1-based line and a snippet. Can take a minute for widely used objects.',
  inputSchema: {
    uri: abapUriSchema.describe('Object folder URI or any of its source files.'),
    maxResults: z.number().int().min(1).max(500).default(100),
  },
  outputSchema: {
    objectName: z.string(),
    usages: z.array(z.object({ uri: z.string(), objectName: z.string(), line: z.number().int(), snippet: z.string() })),
    truncated: z.boolean(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, deps) {
    const object = await resolveObject(deps, args.uri);
    const main = mainSourceOf(object);
    const name = main.classification.name;
    const source = await readSource(deps, main.uri);
    const position = findIdentifierPosition(source, name);
    if (!position) throw new ToolError(`Could not find ${name} in its own source, so where-used cannot be run.`);

    const references = await deps.readQueue.run(() =>
      withTimeout(
        deps.bridge.references(main.uri, position.line, position.character),
        deps.timeouts.whereUsed,
        'Where-used'
      )
    );

    const discovered = new Map<string, IndexEntry[]>();
    const usages = references.map((r) => {
      const leaf = classifyFile(lastSegment(r.uri));
      const destination = destinationOf(r.uri);
      if (leaf && !leaf.isMetadata && destination) {
        const list = discovered.get(destination) ?? [];
        list.push({ name: leaf.name, type: leaf.type, package: '', uri: parentUri(r.uri) });
        discovered.set(destination, list);
      }
      return {
        uri: r.uri,
        objectName: leaf ? leaf.name : lastSegment(r.uri),
        line: r.line,
        snippet: r.snippet.trim().slice(0, 300),
      };
    });
    for (const [destination, entries] of discovered) await deps.index.merge(destination, entries);

    return {
      objectName: name,
      usages: usages.slice(0, args.maxResults),
      truncated: usages.length > args.maxResults,
    };
  },
});
