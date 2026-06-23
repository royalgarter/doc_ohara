#!/usr/bin/env node
// Admin query scripts for the Doc Ohara Space-Time Graph.
// Usage: node scripts/admin_queries.js [query-name]
// Available queries: docs, sections, tags, tag-coverage, missing-tags, repair-stats, all
import { getArangoDBSimulator } from '../src/db/simulator.js';
import fs from 'fs';
import path from 'path';

const db = getArangoDBSimulator();

const queries = {
  // List all ingested documents with key metadata
  docs() {
    const { results } = db.executeAQL(
      'FOR d IN documents SORT d.upload_time DESC RETURN { id: d._key, title: d.title, engine: d.parser_engine, size: d.file_size, uploaded: d.upload_time }'
    );
    console.log('\n=== Documents ===');
    if (!results.length) { console.log('  (none)'); return; }
    results.forEach(d => console.log(`  [${d.id}] ${d.title}  (${d.engine}, ${d.size}, uploaded: ${d.uploaded})`));
    console.log(`  Total: ${results.length}`);
  },

  // List all sections with their parent document
  sections() {
    const { results } = db.executeAQL(
      'FOR s IN sections SORT s.document_id, s.level RETURN { id: s._key, doc: s.document_id, title: s.title, level: s.level }'
    );
    console.log('\n=== Sections ===');
    if (!results.length) { console.log('  (none)'); return; }
    results.forEach(s => console.log(`  [${s.doc}] ${'  '.repeat(s.level || 0)}${s.title}  (level ${s.level})`));
    console.log(`  Total: ${results.length}`);
  },

  // Show all validated SUMO tags across all paragraphs
  tags() {
    const { results } = db.executeAQL('FOR p IN paragraphs RETURN p');
    const tagFreq = {};
    results.forEach(p => {
      (p.sumo_tags || []).forEach(t => { tagFreq[t] = (tagFreq[t] || 0) + 1; });
    });
    const sorted = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]);
    console.log('\n=== SUMO Tag Frequency ===');
    if (!sorted.length) { console.log('  (no tags found)'); return; }
    sorted.forEach(([tag, count]) => console.log(`  ${tag.padEnd(40)} ${count}`));
    console.log(`  Unique tags: ${sorted.length}`);
  },

  // Show tag coverage: percentage of paragraphs that have at least one validated tag
  'tag-coverage'() {
    const { results } = db.executeAQL('FOR p IN paragraphs RETURN p');
    const total = results.length;
    const withTags = results.filter(p => p.sumo_tags && p.sumo_tags.length > 0).length;
    const withCandidates = results.filter(p => p.sumo_candidate_tags_raw && p.sumo_candidate_tags_raw.length > 0).length;
    console.log('\n=== SUMO Tag Coverage ===');
    console.log(`  Total paragraphs:            ${total}`);
    console.log(`  With validated sumo_tags:    ${withTags}  (${pct(withTags, total)})`);
    console.log(`  With raw candidates:         ${withCandidates}  (${pct(withCandidates, total)})`);
    console.log(`  No tags at all:              ${total - withCandidates}  (${pct(total - withCandidates, total)})`);
  },

  // Show paragraphs that have candidate tags but zero validated tags (alias gaps)
  'missing-tags'() {
    const { results } = db.executeAQL('FOR p IN paragraphs RETURN p');
    const gaps = results.filter(p =>
      p.sumo_candidate_tags_raw && p.sumo_candidate_tags_raw.length > 0 &&
      (!p.sumo_tags || p.sumo_tags.length === 0)
    );
    console.log('\n=== Paragraphs with unresolved candidate tags ===');
    if (!gaps.length) { console.log('  (none — great coverage!)'); return; }
    gaps.forEach(p => {
      console.log(`  [${p._key}] candidates: ${p.sumo_candidate_tags_raw.join(', ')}`);
      console.log(`    content: ${String(p.content || '').slice(0, 100)}…`);
    });
    console.log(`  Total gaps: ${gaps.length}`);
  },

  // Show LLM repair statistics from diagnostics export files
  'repair-stats'() {
    const diagDir = path.join('doc_pipeline', 'diagnostics');
    if (!fs.existsSync(diagDir)) { console.log('\n=== Repair Stats ===\n  (no diagnostics files found)'); return; }
    const files = fs.readdirSync(diagDir).filter(f => f.endsWith('.json'));
    if (!files.length) { console.log('\n=== Repair Stats ===\n  (no diagnostics files found)'); return; }

    let totalChunks = 0, totalCacheHits = 0, totalRepairs = 0, totalRepairSuccess = 0, totalFailures = 0;
    console.log('\n=== LLM Repair & Cache Statistics (per run) ===');
    files.sort().reverse().slice(0, 10).forEach(f => {
      const run = JSON.parse(fs.readFileSync(path.join(diagDir, f), 'utf-8'));
      totalChunks += run.total_chunks || 0;
      totalCacheHits += run.cache_hits || 0;
      totalRepairs += run.repairs_attempted || 0;
      totalRepairSuccess += run.repairs_succeeded || 0;
      totalFailures += run.failures || 0;
      console.log(`  ${f}`);
      console.log(`    chunks=${run.total_chunks}  cache_hits=${run.cache_hits}  repairs=${run.repairs_attempted}/${run.repairs_succeeded} ok  failures=${run.failures}`);
    });
    if (files.length > 10) console.log(`  … and ${files.length - 10} older run(s)`);
    console.log(`\n  Totals across shown runs:`);
    console.log(`    chunks=${totalChunks}  cache_hit_rate=${pct(totalCacheHits, totalChunks)}  repair_success_rate=${pct(totalRepairSuccess, totalRepairs)}  failure_rate=${pct(totalFailures, totalChunks)}`);
  },
};

function pct(n, total) {
  if (!total) return '—';
  return `${((n / total) * 100).toFixed(1)}%`;
}

const arg = process.argv[2] || 'all';

if (arg === 'all') {
  Object.values(queries).forEach(fn => fn());
} else if (queries[arg]) {
  queries[arg]();
} else {
  console.error(`Unknown query "${arg}". Available: ${Object.keys(queries).join(', ')}, all`);
  process.exit(1);
}
