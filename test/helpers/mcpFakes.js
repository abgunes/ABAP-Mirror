// Test doubles for the MCP module: an in-memory abap:// tree, a fake
// AdtBridge that records calls, and a ToolDeps factory. Not a test file
// itself (the npm test glob only picks up *.test.js).
const { ObjectIndex } = require('../../out/mcp/objectIndex');
const { createTaskQueue } = require('../../out/mcp/taskQueue');
const { sha256Hex } = require('../../out/mcp/hash');
const { NotFoundError, StaleSourceError } = require('../../out/mcp/types');

const ROOT = 'abap:/repotree-v1/DEV_SYS';

const CLASS_MAIN = [
  'CLASS zcl_demo_job DEFINITION PUBLIC FINAL CREATE PUBLIC.',
  '  PUBLIC SECTION.',
  '    METHODS run.',
  'ENDCLASS.',
  'CLASS zcl_demo_job IMPLEMENTATION.',
  '  METHOD run.',
  '  ENDMETHOD.',
  'ENDCLASS.',
].join('\n');

// Folders are objects, files are strings. Names are the decoded segment names.
function defaultTreeSpec() {
  return {
    'System Library': {
      ZDEMO_ROOT: {
        ZDEMO: {
          'Source Code Library': {
            Classes: {
              ZCL_DEMO_JOB: {
                'zcl_demo_job.clas.abap': CLASS_MAIN,
                'zcl_demo_job.clas.definitions.abap': '* local definitions',
                'zcl_demo_job.clas.implementations.abap': '* local implementations',
                'zcl_demo_job.clas.testclasses.abap': '* tests',
                'zcl_demo_job.clas.json': '{}',
              },
            },
          },
          'Core Data Services': {
            'Data Definitions': {
              ZI_DEMO_VIEW: {
                'zi_demo_view.ddls.acds': 'define view entity ZI_DEMO_VIEW as select from zdemo_tab { key id }',
                'zi_demo_view.ddls.json': '{}',
              },
            },
          },
        },
      },
      SAP_BASIS: {
        'Source Code Library': {
          Classes: { CL_SAP_THING: { 'cl_sap_thing.clas.abap': 'CLASS cl_sap_thing DEFINITION.' } },
        },
      },
      YDEMO: {
        'Source Code Library': {
          Interfaces: { ZIF_DEMO: { 'zif_demo.intf.abap': 'INTERFACE zif_demo PUBLIC.\nENDINTERFACE.' } },
        },
      },
    },
  };
}

function childUri(parent, name) {
  return `${parent}/${encodeURIComponent(name)}`;
}

// Flattens the spec into uri -> DirEntry[] and uri -> content maps.
function buildTree(spec, rootUri = ROOT) {
  const folders = new Map();
  const files = new Map();
  const walk = (uri, node) => {
    const children = [];
    for (const [name, value] of Object.entries(node)) {
      const uriOfChild = childUri(uri, name);
      if (typeof value === 'string') {
        files.set(uriOfChild, value);
        children.push({ name, kind: 'file', uri: uriOfChild });
      } else {
        children.push({ name, kind: 'folder', uri: uriOfChild });
        walk(uriOfChild, value);
      }
    }
    folders.set(uri, children);
  };
  walk(rootUri, spec);
  return { folders, files };
}

function createFakeBridge(options = {}) {
  const tree = options.tree ?? buildTree(options.spec ?? defaultTreeSpec());
  const calls = { writes: [], checks: [], activations: [], locks: [], unlocks: [], references: [], picks: [], readDirectory: [] };
  const bridge = {
    tree,
    calls,
    systems: options.systems ?? [{ destination: 'DEV_SYS', rootUri: ROOT }],
    diagnosticsByUri: new Map(),
    referencesResult: options.referencesResult ?? [],
    pickResult: options.pickResult,
    async listSystems() {
      return bridge.systems;
    },
    async readDirectory(uri) {
      calls.readDirectory.push(uri);
      const children = tree.folders.get(uri);
      if (!children) throw new NotFoundError(uri);
      return children;
    },
    async readFile(uri) {
      if (!tree.files.has(uri)) throw new NotFoundError(uri);
      return tree.files.get(uri);
    },
    async writeSource(uri, source, baseHash) {
      if (sha256Hex(tree.files.get(uri)) !== baseHash) throw new StaleSourceError();
      calls.writes.push({ uri, source });
      tree.files.set(uri, source);
      return { newHash: sha256Hex(source) };
    },
    async check(uri) {
      calls.checks.push(uri);
      return bridge.diagnosticsByUri.get(uri) ?? [];
    },
    unsavedByUri: new Map(),
    unsavedRelated(uri) {
      return bridge.unsavedByUri.get(uri) ?? [];
    },
    async activate(uri) {
      calls.activations.push(uri);
      if (options.activateImpl) await options.activateImpl(uri);
    },
    async lock(uri) {
      calls.locks.push(uri);
      return 'unknown';
    },
    async unlock(uri) {
      calls.unlocks.push(uri);
      return 'unknown';
    },
    async diagnostics(uri) {
      return bridge.diagnosticsByUri.get(uri) ?? [];
    },
    async references(uri, line, character) {
      calls.references.push({ uri, line, character });
      return bridge.referencesResult;
    },
    async pickObjectInteractively(destination, query) {
      calls.picks.push({ destination, query });
      if (typeof bridge.pickResult === 'function') return bridge.pickResult();
      return bridge.pickResult;
    },
  };
  return bridge;
}

function createMemoryIndexStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async load(destination) {
      return data.get(destination);
    },
    async save(destination, entries) {
      data.set(destination, entries);
    },
  };
}

function createDeps(overrides = {}) {
  const confirmRequests = [];
  const logs = [];
  const deps = {
    bridge: overrides.bridge ?? createFakeBridge(),
    confirmer: overrides.confirmer ?? {
      async confirm(request) {
        confirmRequests.push(request);
        return overrides.confirmAnswer ?? true;
      },
    },
    index: new ObjectIndex(overrides.store ?? createMemoryIndexStore()),
    uiQueue: createTaskQueue(1),
    readQueue: createTaskQueue(4),
    settings: {
      confirmWrites: () => overrides.confirmWrites ?? true,
      indexedPackagePrefixes: () => overrides.prefixes ?? ['Z', 'Y'],
    },
    timeouts: {
      read: 500,
      list: 500,
      whereUsed: 500,
      write: 500,
      check: 500,
      activate: 500,
      lock: 500,
      interactive: 200,
      ...overrides.timeouts,
    },
    isStopping: () => false,
    log: (line) => logs.push(line),
  };
  return { deps, confirmRequests, logs };
}

function uriOf(...segments) {
  return segments.reduce((uri, segment) => childUri(uri, segment), ROOT);
}

const CLASS_FOLDER = uriOf('System Library', 'ZDEMO_ROOT', 'ZDEMO', 'Source Code Library', 'Classes', 'ZCL_DEMO_JOB');
const CLASS_MAIN_URI = `${CLASS_FOLDER}/zcl_demo_job.clas.abap`;

module.exports = {
  ROOT,
  CLASS_MAIN,
  CLASS_FOLDER,
  CLASS_MAIN_URI,
  defaultTreeSpec,
  buildTree,
  createFakeBridge,
  createMemoryIndexStore,
  createDeps,
  uriOf,
};
