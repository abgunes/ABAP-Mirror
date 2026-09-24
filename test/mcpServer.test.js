const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startMcpServer, tokenMatches } = require('../out/mcp/server');
const { ALL_TOOLS, runTool } = require('../out/mcp/tools/registry');
const { ToolError } = require('../out/mcp/types');
const { createDeps } = require('./helpers/mcpFakes');

const TOKEN = 'test-token-value';

async function withServer(fn) {
  const { deps, logs } = createDeps();
  const server = await startMcpServer({ port: 0, version: '0.0.0-test', getToken: () => TOKEN, tools: ALL_TOOLS, deps });
  try {
    await fn(server.port, logs);
  } finally {
    await server.close();
  }
}

// Raw http.request so the Host header can be set freely (fetch forbids it).
function post(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: headers.path ?? '/mcp',
        method: headers.method ?? 'POST',
        headers: {
          Host: `127.0.0.1:${port}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${TOKEN}`,
          ...headers.set,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const rpc = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });

test('tokenMatches accepts only the exact bearer token', () => {
  assert.equal(tokenMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches(`bearer   ${TOKEN}  `, TOKEN), true);
  assert.equal(tokenMatches(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(tokenMatches(TOKEN, TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
  assert.equal(tokenMatches('Bearer ', ''), false);
});

test('rejects a missing or wrong token with 401', async () => {
  await withServer(async (port) => {
    const wrong = await post(port, rpc(1, 'tools/list'), { set: { Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers['www-authenticate'], 'Bearer');
    assert.doesNotMatch(wrong.text, new RegExp(TOKEN));
  });
});

test('rejects a foreign Host header and any Origin header with 403', async () => {
  await withServer(async (port) => {
    assert.equal((await post(port, rpc(1, 'tools/list'), { set: { Host: `evil.example:${port}` } })).status, 403);
    assert.equal((await post(port, rpc(1, 'tools/list'), { set: { Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await post(port, rpc(1, 'tools/list'), { set: { Host: `localhost:${port}` } })).status, 200);
  });
});

test('answers 404 off the endpoint path, 405 for GET, 400 for bad JSON, 413 for huge bodies', async () => {
  await withServer(async (port) => {
    assert.equal((await post(port, rpc(1, 'tools/list'), { path: '/other' })).status, 404);
    assert.equal((await post(port, '', { method: 'GET' })).status, 405);
    const bad = await post(port, '{nope');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, -32700);
    assert.equal((await post(port, 'x'.repeat(5 * 1024 * 1024 + 1))).status, 413);
  });
});

test('initialize reports abap-mirror, tools/list returns all tools with schemas', async () => {
  await withServer(async (port) => {
    const init = await post(port, rpc(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    }));
    assert.equal(init.status, 200);
    assert.equal(init.json.result.serverInfo.name, 'abap-mirror');
    assert.match(init.json.result.instructions, /abap_list_systems/);

    const list = await post(port, rpc(2, 'tools/list'));
    const tools = list.json.result.tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'abap_activate',
      'abap_list_folder',
      'abap_list_systems',
      'abap_lock',
      'abap_read_object',
      'abap_refresh_index',
      'abap_search_objects',
      'abap_unlock',
      'abap_where_used',
      'abap_write_source',
    ]);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name);
      assert.equal(tool.outputSchema.type, 'object', tool.name);
    }
    const write = tools.find((t) => t.name === 'abap_write_source');
    assert.deepEqual(write.inputSchema.required.sort(), ['baseHash', 'source', 'uri']);
    assert.equal(write.annotations.destructiveHint, true);
  });
});

test('tools/call round-trips structured content, and bad input comes back as isError', async () => {
  await withServer(async (port, logs) => {
    const ok = await post(port, rpc(3, 'tools/call', { name: 'abap_list_systems', arguments: {} }));
    assert.equal(ok.json.result.structuredContent.systems[0].destination, 'DEV_SYS');
    assert.equal(JSON.parse(ok.json.result.content[0].text).systems.length, 1);
    assert.ok(logs.some((l) => l.startsWith('abap_list_systems ok')));

    const bad = await post(port, rpc(4, 'tools/call', { name: 'abap_list_folder', arguments: { uri: 'file:///x' } }));
    assert.equal(bad.json.result.isError, true);
    assert.match(bad.json.result.content[0].text, /abap:\/\//);
    assert.ok(!logs.some((l) => l.includes(TOKEN)));
  });
});

test('reports a port that is already in use', async () => {
  await withServer(async (port) => {
    const { deps } = createDeps();
    await assert.rejects(
      startMcpServer({ port, version: 'x', getToken: () => TOKEN, tools: ALL_TOOLS, deps }),
      /Port \d+ is already in use/
    );
  });
});

test('runTool turns ToolError into its message and other errors into a prefixed message', async () => {
  const { deps } = createDeps();
  const failing = (error) => ({ name: 'demo', handler: async () => { throw error; } });
  const known = await runTool(failing(new ToolError('clear message')), {}, deps);
  assert.deepEqual(known, { content: [{ type: 'text', text: 'clear message' }], isError: true });
  const unknown = await runTool(failing(new TypeError('x is undefined')), {}, deps);
  assert.equal(unknown.content[0].text, 'demo failed: x is undefined');
});
