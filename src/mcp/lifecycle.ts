import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAdtBridge } from './adtBridge';
import { adtCommLogPathFor, createAdtCommReader } from './adtCommLog';
import { adtLogPathFor, createAdtLogReader } from './adtLog';
import { adtTraceLogPathFor, createAdtTraceReader } from './adtTraceLog';
import { clientConfigSnippets } from './clientConfig';
import { createVsCodeConfirmer } from './confirm';
import { ObjectIndex } from './objectIndex';
import type { RunningMcpServer } from './server';
import { createTaskQueue } from './taskQueue';
import type { ToolDeps } from './tools/toolDefinition';

// Entry point of the MCP module. extension.ts calls registerMcp once; the
// server itself only runs while abapMirror.mcp.enabled is true.
//
// This file must stay cheap to load for the many users who never enable
// MCP: ./server, ./tools/registry, ./tools/searchTools, ./tools/toolDefinition
// (its value side) and ./indexStore all pull in the MCP SDK, zod, hono and
// ajv transitively, so they are loaded with require() inside start() and
// rebuildIndexCommand(), the only two functions that need them, instead of
// as top-level imports.

const TOKEN_SECRET_KEY = 'abapMirror.mcp.token';
const DEFAULT_PORT = 2240;

function mcpConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('abapMirror.mcp');
}

function configuredPort(): number {
  const port = mcpConfig().get<number>('port', DEFAULT_PORT);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
}

function configuredPrefixes(): string[] {
  const prefixes = mcpConfig().get<unknown>('indexedPackagePrefixes', ['Z', 'Y']);
  return Array.isArray(prefixes) ? prefixes.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [];
}

export function registerMcp(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ABAP Mirror MCP');
  const log = (line: string): void => output.appendLine(`${new Date().toISOString()} ${line}`);
  const bridge = createAdtBridge(
    log,
    createAdtLogReader(context.storageUri ? adtLogPathFor(context.storageUri.fsPath) : undefined),
    createAdtTraceReader(adtTraceLogPathFor(context.logUri.fsPath)),
    createAdtCommReader(adtCommLogPathFor(context.logUri.fsPath))
  );
  const confirmer = createVsCodeConfirmer();
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = 'abapMirror.mcp.copyClientConfig';
  context.subscriptions.push(output, bridge, confirmer, statusBar);

  let running: RunningMcpServer | undefined;
  let stopping = false;
  let token = '';
  let tokenPromise: Promise<string> | undefined;
  let deps: ToolDeps | undefined;

  // Built once, on first start() or rebuildIndexCommand(), because ObjectIndex's
  // file-backed store (./indexStore) pulls in zod through ./schemas.
  function buildDeps(): ToolDeps {
    if (!deps) {
      const { DEFAULT_TIMEOUTS } = require('./tools/toolDefinition') as typeof import('./tools/toolDefinition');
      const { createFileIndexStore } = require('./indexStore') as typeof import('./indexStore');
      deps = {
        bridge,
        confirmer,
        index: new ObjectIndex(createFileIndexStore(path.join(context.globalStorageUri.fsPath, 'mcp-index'))),
        uiQueue: createTaskQueue(1),
        readQueue: createTaskQueue(4),
        settings: {
          confirmWrites: () => mcpConfig().get<boolean>('confirmWrites', true),
          indexedPackagePrefixes: configuredPrefixes,
        },
        timeouts: DEFAULT_TIMEOUTS,
        isStopping: () => stopping,
        log,
      };
    }
    return deps;
  }

  // Memoized so two concurrent callers (for example the startup sync() and
  // a copyClientConfig() invoked at the same time) cannot each mint their own
  // token from an empty SecretStorage.
  async function ensureToken(): Promise<string> {
    if (token) return token;
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const stored = await context.secrets.get(TOKEN_SECRET_KEY);
        const value = stored ?? randomBytes(32).toString('base64url');
        if (!stored) await context.secrets.store(TOKEN_SECRET_KEY, value);
        token = value;
        return value;
      })().finally(() => {
        tokenPromise = undefined;
      });
    }
    return tokenPromise;
  }

  async function stop(): Promise<void> {
    if (!running) return;
    stopping = true;
    const server = running;
    running = undefined;
    try {
      await server.close();
      log('MCP server stopped');
    } finally {
      stopping = false;
    }
  }

  async function start(port: number): Promise<void> {
    await ensureToken();
    try {
      const { startMcpServer } = require('./server') as typeof import('./server');
      const { ALL_TOOLS } = require('./tools/registry') as typeof import('./tools/registry');
      running = await startMcpServer({
        port,
        version: String(context.extension.packageJSON.version ?? '0.0.0'),
        getToken: () => token,
        tools: ALL_TOOLS,
        deps: buildDeps(),
      });
      log(`MCP server listening on http://127.0.0.1:${running.port}/mcp`);
      statusBar.text = `$(plug) abap-mirror MCP :${running.port}`;
      statusBar.tooltip = `abap-mirror MCP server on 127.0.0.1:${running.port}. Click to copy a client config.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`MCP server failed to start: ${message}`);
      statusBar.text = '$(error) abap-mirror MCP';
      statusBar.tooltip = `abap-mirror MCP server is not running: ${message}`;
      void vscode.window.showWarningMessage(`abap-mirror MCP server could not start: ${message}`);
    }
    statusBar.show();
  }

  // Serialized so quick setting toggles cannot interleave start and stop.
  let syncChain: Promise<void> = Promise.resolve();
  function sync(): void {
    syncChain = syncChain.then(async () => {
      const enabled = mcpConfig().get<boolean>('enabled', false);
      const port = configuredPort();
      if (!enabled) {
        await stop();
        statusBar.hide();
        return;
      }
      if (running && running.port === port) return;
      await stop();
      await start(port);
    }).catch((error: unknown) => log(`MCP sync failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  async function copyClientConfig(): Promise<void> {
    const snippets = clientConfigSnippets(running?.port ?? configuredPort(), await ensureToken());
    const pick = await vscode.window.showQuickPick(
      snippets.map((s) => ({ label: s.label, detail: s.detail, text: s.text })),
      { title: 'Copy abap-mirror MCP client config', placeHolder: 'Which client format?' }
    );
    if (!pick) return;
    await vscode.env.clipboard.writeText(pick.text);
    const hint = mcpConfig().get<boolean>('enabled', false) ? '' : ' Enable abapMirror.mcp.enabled to start the server.';
    void vscode.window.showInformationMessage(
      `Copied. It contains your MCP token, so treat it like a password.${hint}`
    );
  }

  async function regenerateToken(): Promise<void> {
    // Let an in-flight ensureToken() finish first, or it could write the old
    // token back over the new one.
    await tokenPromise?.catch(() => undefined);
    const value = randomBytes(32).toString('base64url');
    token = value;
    tokenPromise = undefined;
    await context.secrets.store(TOKEN_SECRET_KEY, value);
    log('MCP token regenerated');
    void vscode.window.showInformationMessage(
      'New abap-mirror MCP token created. The old one no longer works; copy the client config again.'
    );
  }

  async function rebuildIndexCommand(): Promise<void> {
    const systems = await bridge.listSystems();
    if (systems.length === 0) {
      void vscode.window.showWarningMessage('No ABAP system is connected in VS Code.');
      return;
    }
    const destination =
      systems.length === 1
        ? systems[0].destination
        : await vscode.window.showQuickPick(systems.map((s) => s.destination), { title: 'Rebuild index for which system?' });
    if (!destination) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `abap-mirror: indexing ${destination}`, cancellable: true },
      async (_progress, cancellation) => {
        try {
          const { rebuildIndex } = require('./tools/searchTools') as typeof import('./tools/searchTools');
          const result = await rebuildIndex(buildDeps(), destination, undefined, () => cancellation.isCancellationRequested);
          const state = result.cancelled ? ' (cancelled)' : result.truncated ? ' (limit reached)' : '';
          void vscode.window.showInformationMessage(
            `abap-mirror indexed ${result.indexed} objects in ${result.packagesScanned} packages of ${destination}${state}.`
          );
        } catch (error) {
          void vscode.window.showErrorMessage(`Indexing failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('abapMirror.mcp.copyClientConfig', copyClientConfig),
    vscode.commands.registerCommand('abapMirror.mcp.regenerateToken', regenerateToken),
    vscode.commands.registerCommand('abapMirror.mcp.rebuildIndex', rebuildIndexCommand),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('abapMirror.mcp')) sync();
    }),
    { dispose: () => void stop() }
  );

  sync();
}
