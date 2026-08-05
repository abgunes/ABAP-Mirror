const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getOrCreateIconFile, clearIconCache } = require('../out/typeIconCache');

function freshCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'abap-mirror-icon-cache-'));
}

test('creates the cache directory and writes an SVG file on first call', () => {
  const cacheDir = freshCacheDir();
  const filePath = getOrCreateIconFile(cacheDir, 'CL', '#2ea043');
  assert.ok(fs.existsSync(filePath));
  const content = fs.readFileSync(filePath, 'utf8');
  assert.match(content, /<svg/);
  assert.match(content, /fill="#2ea043"/);
});

test('returns the same file path for the same abbreviation and color without rewriting it', () => {
  const cacheDir = freshCacheDir();
  const first = getOrCreateIconFile(cacheDir, 'CL', '#2ea043');
  const firstMtime = fs.statSync(first).mtimeMs;
  const second = getOrCreateIconFile(cacheDir, 'CL', '#2ea043');
  assert.equal(second, first);
  assert.equal(fs.statSync(second).mtimeMs, firstMtime);
});

test('different abbreviation/color pairs get different cache files', () => {
  const cacheDir = freshCacheDir();
  const clFile = getOrCreateIconFile(cacheDir, 'CL', '#2ea043');
  const dFile = getOrCreateIconFile(cacheDir, 'D', '#2f81f7');
  assert.notEqual(clFile, dFile);
});

test('the dirty variant gets its own cache file distinct from the clean one', () => {
  const cacheDir = freshCacheDir();
  const clean = getOrCreateIconFile(cacheDir, 'CL', '#2ea043', false);
  const dirty = getOrCreateIconFile(cacheDir, 'CL', '#2ea043', true);
  assert.notEqual(clean, dirty);
  const dirtyContent = fs.readFileSync(dirty, 'utf8');
  assert.match(dirtyContent, /stroke="#f14c4c"/);
  const cleanContent = fs.readFileSync(clean, 'utf8');
  assert.doesNotMatch(cleanContent, /stroke="#f14c4c"/);
});

test('clearIconCache removes every cached icon file', () => {
  const cacheDir = freshCacheDir();
  getOrCreateIconFile(cacheDir, 'CL', '#2ea043');
  clearIconCache(cacheDir);
  assert.equal(fs.existsSync(cacheDir), false);
});
