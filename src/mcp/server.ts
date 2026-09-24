import { createHash, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { runTool } from './tools/registry';
import { AnyToolDefinition, ToolDeps } from './tools/toolDefinition';

// Localhost MCP endpoint (Streamable HTTP, stateless: one McpServer per POST).
// Knows nothing about SAP or VS Code; tools and deps are injected.

export const MCP_PATH = '/mcp';
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export const SERVER_INSTRUCTIONS =
  'abap-mirror gives access to ABAP systems connected in the user\'s VS Code (SAP ADT extension). ' +
  'Typical flow: abap_list_systems, then abap_search_objects (run abap_refresh_index once per system first), ' +
  'abap_read_object, and abap_write_source with the hash from the read. Writes, activation and locks may need ' +
  'the user to confirm in VS Code.';

export interface McpHttpServerOptions {
  port: number;
  version: string;
  getToken(): string;
  tools: AnyToolDefinition[];
  deps: ToolDeps;
}

export interface RunningMcpServer {
  port: number;
  close(): Promise<void>;
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header || !token) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return timingSafeEqual(digest(match[1].trim()), digest(token));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(code: number, message: string): unknown {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

class BodyTooLargeError extends Error {}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function buildMcpServer(options: McpHttpServerOptions): McpServer {
  const server = new McpServer(
    { name: 'abap-mirror', version: options.version },
    { instructions: SERVER_INSTRUCTIONS }
  );
  for (const tool of options.tools) {
    // The SDK validates arguments against inputSchema before calling us, and
    // structuredContent against outputSchema afterwards. The casts only bridge
    // the SDK's deep generic types, which our registry already guarantees.
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      } as any,
      (async (args: unknown) => runTool(tool, args, options.deps)) as any
    );
  }
  return server;
}

export function startMcpServer(options: McpHttpServerOptions): Promise<RunningMcpServer> {
  let boundPort = options.port;

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) {
      sendJson(res, 403, rpcError(-32000, 'Forbidden host.'));
      return;
    }
    if (req.headers.origin !== undefined) {
      sendJson(res, 403, rpcError(-32000, 'Browser origins are not allowed.'));
      return;
    }
    const path = (req.url ?? '').split('?')[0];
    if (path !== MCP_PATH) {
      sendJson(res, 404, rpcError(-32000, `Not found. The MCP endpoint is ${MCP_PATH}.`));
      return;
    }
    if (!tokenMatches(req.headers.authorization, options.getToken())) {
      sendJson(res, 401, rpcError(-32001, 'Missing or wrong bearer token.'), { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, rpcError(-32000, 'Method not allowed. This server is stateless; use POST.'), { Allow: 'POST' });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      if (error instanceof BodyTooLargeError) sendJson(res, 413, rpcError(-32000, 'Request body too large.'));
      else sendJson(res, 400, rpcError(-32700, 'Parse error.'));
      return;
    }

    const server = buildMcpServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      options.deps.log(`MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, 'Internal error.'));
      else res.end();
    });
  });

  return new Promise<RunningMcpServer>((resolve, reject) => {
    httpServer.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${options.port} is already in use. Change abapMirror.mcp.port.`)
          : error
      );
    });
    httpServer.listen(options.port, '127.0.0.1', () => {
      boundPort = (httpServer.address() as AddressInfo).port;
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((done) => {
            httpServer.close(() => done());
            httpServer.closeAllConnections();
          }),
      });
    });
  });
}
