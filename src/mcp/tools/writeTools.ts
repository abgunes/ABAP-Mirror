import { z } from 'zod';
import { classifyFile, lastSegment } from '../abapUri';
import { sha256Hex } from '../hash';
import { abapUriSchema, diagnosticSchema } from '../schemas';
import { withTimeout } from '../taskQueue';
import { DiagnosticInfo, StaleSourceError, ToolError } from '../types';
import { confirmOrThrow, errorMessage, mainSourceOf, readSource, requireDestination, resolveObject } from './common';
import { defineTool, ToolDeps } from './toolDefinition';

function hasErrors(diagnostics: DiagnosticInfo[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

export const writeSourceTool = defineTool({
  name: 'abap_write_source',
  title: 'Save ABAP source',
  description:
    'Replaces one source part of an ABAP object and saves it to SAP through VS Code, optionally activating it. ' +
    'baseHash must be the hash from abap_read_object; if the source changed since then the write is refused. ' +
    'The user may have to confirm in VS Code and pick a transport request.',
  inputSchema: {
    uri: abapUriSchema.describe('URI of one source part file, from abap_read_object parts[].uri.'),
    source: z.string().max(4_000_000).describe('Complete new source of that part.'),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/, 'Use the hash returned by abap_read_object.'),
    activate: z.boolean().default(false),
  },
  outputSchema: {
    saved: z.boolean(),
    activated: z.boolean().optional(),
    activationError: z.string().optional(),
    newHash: z.string(),
    diagnostics: z.array(diagnosticSchema),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async handler(args, deps) {
    const destination = requireDestination(args.uri);
    const leaf = classifyFile(lastSegment(args.uri));
    if (!leaf || leaf.isMetadata) {
      throw new ToolError('uri must be an ABAP source file (for example .clas.abap) from abap_read_object parts[].uri.');
    }
    return deps.uiQueue.run(async () => {
      const current = await readSource(deps, args.uri);
      if (sha256Hex(current) !== args.baseHash) throw new StaleSourceError();
      if (current === args.source && !args.activate) {
        return { saved: false, newHash: args.baseHash, diagnostics: await deps.bridge.diagnostics(args.uri) };
      }
      await confirmOrThrow(deps, {
        action: args.activate ? 'write_activate' : 'write',
        objectLabel: `${leaf.name} (${leaf.part})`,
        destination,
        uri: args.uri,
        currentSource: current,
        proposedSource: args.source,
      });
      let newHash = args.baseHash;
      let saved = false;
      if (current !== args.source) {
        newHash = (await withTimeout(deps.bridge.writeSource(args.uri, args.source, args.baseHash), deps.timeouts.write, 'Save')).newHash;
        saved = true;
      }
      if (!args.activate) return { saved, newHash, diagnostics: await deps.bridge.diagnostics(args.uri) };
      try {
        await withTimeout(deps.bridge.activate(args.uri), deps.timeouts.activate, 'Activation');
      } catch (error) {
        // The save already happened; report the activation failure without hiding that.
        return { saved, activated: false, activationError: errorMessage(error), newHash, diagnostics: [] };
      }
      const diagnostics = await deps.bridge.diagnostics(args.uri);
      return { saved, activated: !hasErrors(diagnostics), newHash, diagnostics };
    });
  },
});

export const activateTool = defineTool({
  name: 'abap_activate',
  title: 'Activate ABAP objects',
  description:
    'Activates up to 20 ABAP objects through the SAP ADT extension, one after another, and returns the ' +
    'diagnostics of each. The user may have to confirm in VS Code.',
  inputSchema: {
    uris: z.array(abapUriSchema).min(1).max(20).describe('Object folder URIs or any of their source files.'),
  },
  outputSchema: {
    results: z.array(
      z.object({
        uri: z.string(),
        activated: z.boolean(),
        error: z.string().optional(),
        diagnostics: z.array(diagnosticSchema),
      })
    ),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, deps) {
    const objects = await Promise.all(args.uris.map((uri) => resolveObject(deps, uri)));
    const mains = objects.map(mainSourceOf);
    return deps.uiQueue.run(async () => {
      await confirmOrThrow(deps, {
        action: 'activate',
        objectLabel: mains.map((m) => m.classification.name).join(', '),
        destination: objects[0].destination,
        uri: mains[0].uri,
      });
      const results = [];
      for (let i = 0; i < mains.length; i++) {
        try {
          await withTimeout(deps.bridge.activate(mains[i].uri), deps.timeouts.activate, 'Activation');
          const diagnostics = await deps.bridge.diagnostics(mains[i].uri);
          results.push({ uri: args.uris[i], activated: !hasErrors(diagnostics), diagnostics });
        } catch (error) {
          results.push({ uri: args.uris[i], activated: false, error: errorMessage(error), diagnostics: [] });
        }
      }
      return { results };
    });
  },
});

async function runLockCommand(deps: ToolDeps, uri: string, kind: 'lock' | 'unlock') {
  const object = await resolveObject(deps, uri);
  const main = mainSourceOf(object);
  return deps.uiQueue.run(async () => {
    await confirmOrThrow(deps, {
      action: kind,
      objectLabel: main.classification.name,
      destination: object.destination,
      uri: main.uri,
    });
    const operation = kind === 'lock' ? deps.bridge.lock(main.uri) : deps.bridge.unlock(main.uri);
    const status = await withTimeout<string>(operation, deps.timeouts.lock, kind === 'lock' ? 'Lock' : 'Unlock');
    return { requested: true as const, status: status as 'locked' | 'unlocked' | 'unknown' };
  });
}

const lockOutputSchema = {
  requested: z.literal(true),
  status: z.enum(['locked', 'unlocked', 'unknown']),
};

export const lockTool = defineTool({
  name: 'abap_lock',
  title: 'Lock an ABAP object',
  description:
    'Asks the SAP ADT extension to lock an object for editing. status is "unknown" when SAP gives no observable ' +
    'confirmation; saving also locks implicitly.',
  inputSchema: { uri: abapUriSchema },
  outputSchema: lockOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, deps) {
    return runLockCommand(deps, args.uri, 'lock');
  },
});

export const unlockTool = defineTool({
  name: 'abap_unlock',
  title: 'Unlock an ABAP object',
  description: 'Asks the SAP ADT extension to release the lock on an object.',
  inputSchema: { uri: abapUriSchema },
  outputSchema: lockOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, deps) {
    return runLockCommand(deps, args.uri, 'unlock');
  },
});
