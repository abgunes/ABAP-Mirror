import { listFolderTool, listSystemsTool } from './browseTools';
import { readObjectTool, whereUsedTool } from './readTools';
import { refreshIndexTool, searchObjectsTool } from './searchTools';
import { AnyToolDefinition, ToolDefinition, ToolDeps } from './toolDefinition';
import { activateTool, editSourceTool, lockTool, unlockTool, writeSourceTool } from './writeTools';
import { ToolError } from '../types';

// Adding a tool = one entry here; server.ts registers whatever this list holds.
export const ALL_TOOLS: AnyToolDefinition[] = [
  listSystemsTool,
  searchObjectsTool,
  listFolderTool,
  refreshIndexTool,
  readObjectTool,
  writeSourceTool,
  editSourceTool,
  activateTool,
  lockTool,
  unlockTool,
  whereUsedTool,
];

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// Turns a handler outcome into an MCP tool result. Errors become isError
// results (the SDK then skips output-schema validation for them).
export async function runTool(
  tool: ToolDefinition<any, any>,
  args: unknown,
  deps: ToolDeps
): Promise<ToolCallResult> {
  const started = Date.now();
  try {
    const output = (await tool.handler(args as Record<string, unknown>, deps)) as Record<string, unknown>;
    deps.log(`${tool.name} ok ${Date.now() - started} ms`);
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
  } catch (error) {
    const known = error instanceof ToolError;
    const message = error instanceof Error ? error.message : String(error);
    deps.log(`${tool.name} failed ${Date.now() - started} ms: ${message}`);
    return { content: [{ type: 'text', text: known ? message : `${tool.name} failed: ${message}` }], isError: true };
  }
}
