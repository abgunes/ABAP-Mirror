// Requiring lifecycle.js must stay cheap for the many users who never turn
// on abapMirror.mcp.enabled: the MCP SDK, zod and hono only belong on the
// heap once start() or rebuildIndexCommand() actually run. There is no real
// 'vscode' module outside a running VS Code host, so this test stubs just
// enough of it (adtBridge.ts reads vscode.DiagnosticSeverity at module scope)
// to let plain `node --test` load the compiled module and inspect what it
// pulled into require.cache. It never calls registerMcp.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const vscodeStub = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  FileSystemError: class FileSystemError extends Error {},
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode';
  return originalResolveFilename.call(this, request, ...rest);
};
require.cache.vscode = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: vscodeStub,
  children: [],
  paths: [],
};

const FORBIDDEN_SUBSTRINGS = [
  '@modelcontextprotocol',
  'node_modules/zod',
  'node_modules\\zod',
  'node_modules/hono',
  'node_modules\\hono',
  '@hono',
];

test('requiring lifecycle.js does not load the MCP SDK, zod or hono', () => {
  require('../out/mcp/lifecycle');
  const loadedHeavyModules = Object.keys(require.cache).filter((key) =>
    FORBIDDEN_SUBSTRINGS.some((substring) => key.includes(substring))
  );
  assert.deepEqual(loadedHeavyModules, []);
});
