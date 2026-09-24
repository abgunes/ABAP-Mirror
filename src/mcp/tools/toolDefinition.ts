import { z } from 'zod';
import { ObjectIndex } from '../objectIndex';
import { TaskQueue } from '../taskQueue';
import { AdtBridge, Confirmer } from '../types';

export interface Timeouts {
  read: number;
  list: number;
  whereUsed: number;
  write: number;
  activate: number;
  lock: number;
  interactive: number;
}

export const DEFAULT_TIMEOUTS: Timeouts = {
  read: 30_000,
  list: 30_000,
  whereUsed: 120_000,
  write: 180_000,
  activate: 120_000,
  lock: 60_000,
  interactive: 180_000,
};

export interface ToolSettings {
  confirmWrites(): boolean;
  indexedPackagePrefixes(): string[];
}

// Everything a tool handler may use. Built once by lifecycle.ts; tests pass fakes.
export interface ToolDeps {
  bridge: AdtBridge;
  confirmer: Confirmer;
  index: ObjectIndex;
  /** One at a time: anything that needs the active editor or shows UI. */
  uiQueue: TaskQueue;
  /** At most 4 at a time: plain reads against SAP. */
  readQueue: TaskQueue;
  settings: ToolSettings;
  timeouts: Timeouts;
  isStopping(): boolean;
  log(line: string): void;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition<I extends z.ZodRawShape, O extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  annotations: ToolAnnotations;
  // Method syntax on purpose: keeps handler parameters bivariant so every
  // concrete tool fits into AnyToolDefinition.
  handler(args: z.output<z.ZodObject<I>>, deps: ToolDeps): Promise<z.input<z.ZodObject<O>>>;
}

export type AnyToolDefinition = ToolDefinition<z.ZodRawShape, z.ZodRawShape>;

export function defineTool<I extends z.ZodRawShape, O extends z.ZodRawShape>(
  definition: ToolDefinition<I, O>
): ToolDefinition<I, O> {
  return definition;
}
