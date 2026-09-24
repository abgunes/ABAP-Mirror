const test = require('node:test');
const assert = require('node:assert/strict');
const { mcpUrl, clientConfigSnippets } = require('../out/mcp/clientConfig');
const { summarizeLineChanges } = require('../out/mcp/diffSummary');

test('mcpUrl points at the loopback /mcp endpoint', () => {
  assert.equal(mcpUrl(2240), 'http://127.0.0.1:2240/mcp');
});

test('clientConfigSnippets gives mcpServers JSON, a Claude CLI command and VS Code mcp.json', () => {
  const [generic, cli, vscode] = clientConfigSnippets(3000, 'tok-123');
  const expectedEntry = {
    type: 'http',
    url: 'http://127.0.0.1:3000/mcp',
    headers: { Authorization: 'Bearer tok-123' },
  };
  assert.deepEqual(JSON.parse(generic.text), { mcpServers: { 'abap-mirror': expectedEntry } });
  assert.equal(
    cli.text,
    'claude mcp add --transport http abap-mirror http://127.0.0.1:3000/mcp --header "Authorization: Bearer tok-123"'
  );
  assert.deepEqual(JSON.parse(vscode.text), { servers: { 'abap-mirror': expectedEntry } });
});

test('summarizeLineChanges counts added and removed lines', () => {
  assert.deepEqual(summarizeLineChanges('a\nb\nc', 'a\nB\nc\nd'), { added: 2, removed: 1 });
  assert.deepEqual(summarizeLineChanges('same', 'same'), { added: 0, removed: 0 });
});

test('summarizeLineChanges treats moved lines as unchanged and ignores CRLF vs LF', () => {
  assert.deepEqual(summarizeLineChanges('a\r\nb', 'b\na'), { added: 0, removed: 0 });
});

test('summarizeLineChanges counts duplicated lines', () => {
  assert.deepEqual(summarizeLineChanges('x', 'x\nx\nx'), { added: 2, removed: 0 });
});
