import { z } from 'zod';
import { abapUriSchema } from '../schemas';
import { NOT_CONNECTED_MESSAGE, ToolError } from '../types';
import { listFolder, requireDestination } from './common';
import { defineTool } from './toolDefinition';

export const listSystemsTool = defineTool({
  name: 'abap_list_systems',
  title: 'List connected ABAP systems',
  description:
    'Lists the SAP systems (destinations) currently connected in VS Code through the SAP ADT extension, ' +
    'with the abap:// root URI of each. Call this first.',
  inputSchema: {},
  outputSchema: {
    systems: z.array(z.object({ destination: z.string(), rootUri: z.string() })),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(_args, deps) {
    const systems = await deps.bridge.listSystems();
    if (systems.length === 0) throw new ToolError(NOT_CONNECTED_MESSAGE);
    return { systems };
  },
});

export const listFolderTool = defineTool({
  name: 'abap_list_folder',
  title: 'List an ABAP repository folder',
  description:
    'Lists the children of an abap:// folder (packages, grouping folders, object folders, source files). ' +
    'Use it to browse from a system root URI when search finds nothing.',
  inputSchema: {
    uri: abapUriSchema.describe('abap:// folder URI, e.g. a rootUri from abap_list_systems.'),
  },
  outputSchema: {
    children: z.array(z.object({ name: z.string(), kind: z.enum(['folder', 'file']), uri: z.string() })),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, deps) {
    requireDestination(args.uri);
    const children = await listFolder(deps, args.uri);
    return { children };
  },
});
