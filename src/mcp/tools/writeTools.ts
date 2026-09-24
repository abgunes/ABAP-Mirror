import { z } from 'zod';
import { classifyFile, FileClassification, lastSegment } from '../abapUri';
import { sha256Hex } from '../hash';
import { abapUriSchema, diagnosticSchema } from '../schemas';
import { withTimeout } from '../taskQueue';
import { DiagnosticInfo, StaleSourceError, TimeoutError, ToolError } from '../types';
import { confirmOrThrow, errorMessage, mainSourceOf, readSource, requireDestination, resolveObject } from './common';
import { defineTool, ToolDeps } from './toolDefinition';

function hasErrors(diagnostics: DiagnosticInfo[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

const baseHashSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Use the hash returned by abap_read_object.');

interface WriteOutcome {
  saved: boolean;
  activated?: boolean;
  activationError?: string;
  newHash: string;
  diagnostics: DiagnosticInfo[];
}

// Shared by abap_write_source and abap_edit_source: read the current source,
// check it against baseHash, compute the new source, confirm, save, and
// optionally activate. computeNewSource never sees a stale current source
// because it runs right after the hash check, before any confirmation.
async function performWrite(
  deps: ToolDeps,
  args: { uri: string; baseHash: string; activate: boolean },
  leaf: FileClassification,
  destination: string,
  computeNewSource: (current: string) => string
): Promise<WriteOutcome> {
  const current = await readSource(deps, args.uri);
  if (sha256Hex(current) !== args.baseHash) throw new StaleSourceError();
  const source = computeNewSource(current);
  if (current === source && !args.activate) {
    return { saved: false, newHash: args.baseHash, diagnostics: await deps.bridge.diagnostics(args.uri) };
  }
  const noOp = current === source;
  await confirmOrThrow(deps, {
    action: noOp ? 'activate' : args.activate ? 'write_activate' : 'write',
    objectLabel: `${leaf.name} (${leaf.part})`,
    destination,
    uri: args.uri,
    ...(noOp ? {} : { currentSource: current, proposedSource: source }),
  });
  let newHash = args.baseHash;
  let saved = false;
  if (!noOp) {
    try {
      newHash = (await withTimeout(deps.bridge.writeSource(args.uri, source, args.baseHash), deps.timeouts.write, 'Save')).newHash;
    } catch (error) {
      if (!(error instanceof TimeoutError)) throw error;
      throw new ToolError(`${error.message} The save may still complete in VS Code; re-read the object before retrying.`);
    }
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
}

function requireSourceLeaf(uri: string): FileClassification {
  const leaf = classifyFile(lastSegment(uri));
  if (!leaf || leaf.isMetadata) {
    throw new ToolError('uri must be an ABAP source file (for example .clas.abap) from abap_read_object parts[].uri.');
  }
  return leaf;
}

const writeOutputSchema = {
  saved: z.boolean(),
  activated: z.boolean().optional(),
  activationError: z.string().optional(),
  newHash: z.string(),
  diagnostics: z.array(diagnosticSchema),
};

export const writeSourceTool = defineTool({
  name: 'abap_write_source',
  title: 'Save ABAP source',
  description:
    'Replaces one source part of an ABAP object and saves it to SAP through VS Code, optionally activating it. ' +
    'baseHash must be the hash from abap_read_object; if the source changed since then the write is refused. ' +
    'The user may have to confirm in VS Code and pick a transport request. For a small change to a large part, ' +
    'abap_edit_source is cheaper: it only needs the changed text, not the whole part.',
  inputSchema: {
    uri: abapUriSchema.describe('URI of one source part file, from abap_read_object parts[].uri.'),
    source: z.string().max(4_000_000).describe('Complete new source of that part.'),
    baseHash: baseHashSchema,
    activate: z.boolean().default(false),
  },
  outputSchema: writeOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async handler(args, deps) {
    const destination = requireDestination(args.uri);
    const leaf = requireSourceLeaf(args.uri);
    return deps.uiQueue.run(() => performWrite(deps, args, leaf, destination, () => args.source));
  },
});

const sourceEditSchema = z.object({
  oldString: z.string().min(1).max(200_000).describe('Exact text to find in the current source.'),
  newString: z.string().max(200_000).describe('Text to put in its place.'),
  replaceAll: z.boolean().default(false).describe('Replace every match instead of requiring exactly one.'),
});

// Applies edits in order against source, in memory. Throws before any edit
// is written if any oldString does not match exactly once (or, with
// replaceAll, at least once), so a batch either all applies or writes nothing.
function applyEdits(source: string, edits: Array<z.output<typeof sourceEditSchema>>): string {
  let result = source;
  edits.forEach((edit, index) => {
    const label = `Edit ${index + 1} of ${edits.length}`;
    const count = countOccurrences(result, edit.oldString);
    if (count === 0) throw new ToolError(`${label}: oldString was not found in the current source.`);
    if (count > 1 && !edit.replaceAll) {
      throw new ToolError(`${label}: oldString matches ${count} times; make it unique or set replaceAll.`);
    }
    result = edit.replaceAll ? result.split(edit.oldString).join(edit.newString) : replaceFirst(result, edit.oldString, edit.newString);
  });
  return result;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, from)) {
    count++;
    from = at + needle.length;
  }
  return count;
}

function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const at = haystack.indexOf(needle);
  return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
}

export const editSourceTool = defineTool({
  name: 'abap_edit_source',
  title: 'Edit ABAP source',
  description:
    'Applies one or more exact-text replacements to one source part of an ABAP object and saves it to SAP through ' +
    'VS Code, optionally activating it. Send only the changed text, not the whole part. Each oldString must match ' +
    'the current source exactly and, unless replaceAll is set, exactly once; if any edit does not match, nothing ' +
    'is written. baseHash must be the hash from abap_read_object (or from a previous abap_write_source / ' +
    'abap_edit_source call); if the source changed since then the edit is refused.',
  inputSchema: {
    uri: abapUriSchema.describe('URI of one source part file, from abap_read_object parts[].uri.'),
    baseHash: baseHashSchema,
    edits: z.array(sourceEditSchema).min(1).max(50),
    activate: z.boolean().default(false),
  },
  outputSchema: writeOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async handler(args, deps) {
    const destination = requireDestination(args.uri);
    const leaf = requireSourceLeaf(args.uri);
    return deps.uiQueue.run(() => performWrite(deps, args, leaf, destination, (current) => applyEdits(current, args.edits)));
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
        destination: [...new Set(objects.map((o) => o.destination))].join(', '),
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
    'Asks the SAP ADT extension to lock an object for editing. Fails when SAP refuses the lock (for example another ' +
    'session is editing the object). status is "unknown" when ADT made no call to SAP, for example because the ' +
    'object was already locked; saving also locks implicitly.',
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
