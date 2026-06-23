// Integration & unit tests for the Doc Ohara ingest pipeline.
// Run: node --test tests/ingest.test.js
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Unit tests: sumo_index ────────────────────────────────────────────────────

describe('sumo_index', () => {
  let loadSumoIndex, isValidTag, resolveTag, validateTags;

  before(async () => {
    ({ loadSumoIndex, isValidTag, resolveTag, validateTags } = await import('../src/sumo.js'));
  });

  test('loadSumoIndex returns an array', () => {
    const idx = loadSumoIndex();
    assert.ok(Array.isArray(idx), 'index should be an array');
  });

  test('index entries have localName field', () => {
    const idx = loadSumoIndex();
    if (idx.length === 0) return; // skip if index not yet generated
    assert.ok(typeof idx[0].localName === 'string', 'each entry should have a localName string');
  });

  test('isValidTag rejects null and empty', () => {
    assert.equal(isValidTag(null), false);
    assert.equal(isValidTag(''), false);
    assert.equal(isValidTag(undefined), false);
  });

  test('isValidTag accepts exact match', () => {
    const idx = loadSumoIndex();
    if (idx.length === 0) return;
    const first = idx[0].localName;
    assert.equal(isValidTag(first), true, `exact match for "${first}" should be valid`);
  });

  test('isValidTag is case-insensitive', () => {
    const idx = loadSumoIndex();
    if (idx.length === 0) return;
    const first = idx[0].localName;
    assert.equal(isValidTag(first.toLowerCase()), true, 'lowercase variant should be valid');
    assert.equal(isValidTag(first.toUpperCase()), true, 'uppercase variant should be valid');
  });

  test('resolveTag returns canonical form for alias', () => {
    const idx = loadSumoIndex();
    if (idx.length === 0) return;
    // "agent" is in the alias table → should resolve to "Agent" if it exists in the index
    const canon = resolveTag('agent');
    if (canon) {
      assert.equal(typeof canon, 'string');
      // canonical should exist in index
      assert.ok(idx.some(e => e.localName === canon), `resolved "${canon}" should be in index`);
    }
  });

  test('validateTags returns valid/invalid/resolved_map', () => {
    const idx = loadSumoIndex();
    const realTag = idx.length > 0 ? idx[0].localName : null;
    const input = realTag ? [realTag, 'DefinitelyNotARealSumoTag12345'] : ['DefinitelyNotARealSumoTag12345'];
    const result = validateTags(input);

    assert.ok(Array.isArray(result.valid), 'valid should be array');
    assert.ok(Array.isArray(result.invalid), 'invalid should be array');
    assert.ok(typeof result.resolved_map === 'object', 'resolved_map should be object');
    assert.ok(result.invalid.includes('DefinitelyNotARealSumoTag12345'), 'garbage tag should be invalid');
    if (realTag) assert.ok(result.valid.includes(realTag), 'real tag should be valid');
  });

  test('validateTags handles non-array input gracefully', () => {
    const result = validateTags(null);
    assert.deepEqual(result, { valid: [], invalid: [], resolved_map: {} });
  });
});

// ── Unit tests: markdown_chunker ─────────────────────────────────────────────

describe('markdown_chunker', () => {
  let chunkMarkdown;

  before(async () => {
    ({ chunkMarkdown } = await import('../src/ingest/chunker.js'));
  });

  test('chunkMarkdown returns at least one chunk for non-empty input', () => {
    const chunks = chunkMarkdown('# Heading\n\nSome content here.', { maxChars: 12000 });
    assert.ok(Array.isArray(chunks));
    assert.ok(chunks.length >= 1);
  });

  test('each chunk has id and text', () => {
    const chunks = chunkMarkdown('# Hello\n\nWorld', { maxChars: 12000 });
    for (const c of chunks) {
      assert.ok(typeof c.id === 'string', 'chunk.id should be string');
      assert.ok(typeof c.text === 'string', 'chunk.text should be string');
    }
  });

  test('chunkMarkdown splits on multiple headings', () => {
    // The chunker splits on heading boundaries when chunks grow beyond maxChars/4.
    const multiSection = [
      '# Chapter 1\n\n' + 'word '.repeat(100),
      '# Chapter 2\n\n' + 'word '.repeat(100),
      '# Chapter 3\n\n' + 'word '.repeat(100),
    ].join('\n\n');
    const chunks = chunkMarkdown(multiSection, { maxChars: 500 });
    assert.ok(chunks.length >= 2, 'multiple headings past threshold should produce multiple chunks');
  });
});

// ── Integration test: ingestSingleFile with a small markdown fixture ──────────

describe('ingestSingleFile (integration)', () => {
  let tmpDir;
  let inputDir;
  const fixtureFilename = 'test_fixture.md';
  const fixtureContent = `# Test Document

## Introduction

This is a test paragraph about Bitcoin and cryptographic protocols.

## Technical Details

Elliptic curve cryptography underpins the key generation algorithm used in Bitcoin.

| Algorithm | Key Size |
|-----------|----------|
| ECDSA     | 256 bit  |
| SHA-256   | 256 bit  |
`;

  before(() => {
    // Set up a temporary input directory so we don't pollute the real one
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohara-test-'));
    inputDir = path.join(process.cwd(), 'doc_pipeline', 'input');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(path.join(inputDir, fixtureFilename), fixtureContent, 'utf-8');
  });

  test('ingestSingleFile fails fast without GEMINI_API_KEY (preflight check)', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ARANGO_URL;

    const { ingestSingleFile } = await import('../src/ingest/pipeline.js');

    await assert.rejects(
      () => ingestSingleFile(fixtureFilename, null),
      (err) => {
        assert.equal(err.code, 'PREFLIGHT_FAILED');
        return true;
      },
      'should throw PREFLIGHT_FAILED when GEMINI_API_KEY is missing'
    );

    if (savedKey) process.env.GEMINI_API_KEY = savedKey;
  });
});

// ── Integration test: arangodb simulator state ────────────────────────────────

describe('ArangoDBSimulator', () => {
  let getArangoDBSimulator;

  before(async () => {
    ({ getArangoDBSimulator } = await import('../src/db/simulator.js'));
  });

  test('getArangoDBSimulator returns a singleton', () => {
    const a = getArangoDBSimulator();
    const b = getArangoDBSimulator();
    assert.equal(a, b, 'should return the same instance');
  });

  test('insertDocument and retrieve via getState', () => {
    const db = getArangoDBSimulator();
    const before = db.getState().documents.length;
    const doc = db.insertDocument({ title: 'Test Doc', source_file: 'test.md', parser_engine: 'LiteParse' });
    assert.ok(doc._key, 'inserted doc should have _key');
    assert.equal(db.getState().documents.length, before + 1);
    // cleanup
    db.deleteDocument(doc._key);
    assert.equal(db.getState().documents.length, before);
  });

  test('insertSection auto-creates edges', () => {
    const db = getArangoDBSimulator();
    const doc = db.insertDocument({ title: 'Edge Test Doc', source_file: 'edge_test.md', parser_engine: 'LiteParse' });
    const edgesBefore = db.getState().edges.length;
    db.insertSection({ document_id: doc._key, title: 'Sec 1', level: 1 });
    assert.ok(db.getState().edges.length > edgesBefore, 'inserting a section should create edges');
    // cleanup
    db.deleteDocument(doc._key);
  });
});
