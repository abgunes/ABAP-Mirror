import { classifyFile, destinationOf, FileClassification, isAbapUri, lastSegment, parentUri } from '../abapUri';
import { withTimeout } from '../taskQueue';
import { ConfirmRequest, DirEntry, NOT_CONNECTED_MESSAGE, SourcePart, SystemInfo, ToolError } from '../types';
import { ToolDeps } from './toolDefinition';

// Helpers shared by several tools. They only use ToolDeps, never vscode.

export async function requireSystems(deps: ToolDeps, destination?: string): Promise<SystemInfo[]> {
  const systems = await deps.bridge.listSystems();
  if (systems.length === 0) throw new ToolError(NOT_CONNECTED_MESSAGE);
  if (destination === undefined) return systems;
  const match = systems.find((s) => s.destination.toUpperCase() === destination.toUpperCase());
  if (!match) {
    const known = systems.map((s) => s.destination).join(', ');
    throw new ToolError(`Destination "${destination}" is not connected in VS Code. Connected: ${known}.`);
  }
  return [match];
}

export function requireDestination(uri: string): string {
  const destination = isAbapUri(uri) ? destinationOf(uri) : undefined;
  if (!destination) throw new ToolError(`Not an ABAP repository URI: ${uri}`);
  return destination;
}

export function listFolder(deps: ToolDeps, uri: string): Promise<DirEntry[]> {
  return deps.readQueue.run(() => withTimeout(deps.bridge.readDirectory(uri), deps.timeouts.list, 'Listing folder'));
}

export function readSource(deps: ToolDeps, uri: string): Promise<string> {
  return deps.readQueue.run(() => withTimeout(deps.bridge.readFile(uri), deps.timeouts.read, 'Reading source'));
}

export interface SourceFile {
  uri: string;
  classification: FileClassification;
}

export interface ResolvedObject {
  destination: string;
  folderUri: string;
  sources: SourceFile[]; // ordered main, definitions, implementations, macros, testclasses, other
}

const PART_ORDER: SourcePart[] = ['main', 'definitions', 'implementations', 'macros', 'testclasses', 'other'];

/** Accepts an object folder URI or the URI of one of its files. */
export async function resolveObject(deps: ToolDeps, uri: string): Promise<ResolvedObject> {
  const destination = requireDestination(uri);
  const leaf = classifyFile(lastSegment(uri));
  const folderUri = leaf ? parentUri(uri) : uri;
  const children = await listFolder(deps, folderUri);
  const sources: SourceFile[] = [];
  for (const child of children) {
    if (child.kind !== 'file') continue;
    const classification = classifyFile(child.name);
    if (classification && !classification.isMetadata) sources.push({ uri: child.uri, classification });
  }
  if (sources.length === 0) {
    throw new ToolError(
      `No ABAP source files found in ${folderUri}. Pass the URI of an object folder or one of its source files.`
    );
  }
  sources.sort((a, b) => PART_ORDER.indexOf(a.classification.part) - PART_ORDER.indexOf(b.classification.part));
  return { destination, folderUri, sources };
}

export function mainSourceOf(object: ResolvedObject): SourceFile {
  return object.sources.find((s) => s.classification.part === 'main') ?? object.sources[0];
}

const ACTION_LABEL: Record<ConfirmRequest['action'], string> = {
  write: 'saving',
  write_activate: 'saving and activating',
  activate: 'activating',
  lock: 'locking',
  unlock: 'unlocking',
};

export async function confirmOrThrow(deps: ToolDeps, request: ConfirmRequest): Promise<void> {
  if (!deps.settings.confirmWrites()) return;
  const allowed = await deps.confirmer.confirm(request);
  if (!allowed) throw new ToolError(`User denied ${ACTION_LABEL[request.action]} ${request.objectLabel} in VS Code.`);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
