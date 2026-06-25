#!/usr/bin/env node
// Doc Ohara — CLI reference. Run: npm run help

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const GRAY   = '\x1b[90m';

const b = s => `${BOLD}${s}${RESET}`;
const c = s => `${CYAN}${s}${RESET}`;
const y = s => `${YELLOW}${s}${RESET}`;
const g = s => `${GREEN}${s}${RESET}`;
const d = s => `${GRAY}${s}${RESET}`;

const sections = [
	{
		title: 'Server',
		cmds: [
			['npm run dev',   'Start Express server with nodemon (hot-reload). Opens http://localhost:3000'],
			['npm start',     'Start Express server (production, no reload)'],
		],
	},
	{
		title: 'Ingest',
		cmds: [
			['npm run ohara:ingest',                                   'Ingest sample PDF (sample/Mastering Bitcoin 2nd.pdf)'],
			['node bin/ohara.js ingest <path>',                        'Ingest any PDF / EPUB / DOCX / MD file'],
			['node bin/ohara.js ingest <path> --force',                'Re-ingest even if already processed (bypass dedup)'],
		],
	},
	{
		title: 'Query',
		cmds: [
			['npm run ohara:query',                                    'Run sample query ("bitcoin theoretical")'],
			['npm run ohara:query:expand',                             'Same query with deeper cross-doc expansion (depth=2, limit=10)'],
			['node bin/ohara.js query "<text>"',                       '5-phase hybrid search: BM25 + SUMO + entity pivot + structural'],
			['node bin/ohara.js query "<text>" --tiers',               'Show Principal / Integrity / Explorer tier breakdown'],
			['node bin/ohara.js query "<text>" --tiers --verbose',     'Tiers + per-result score/source annotation'],
			['node bin/ohara.js query "<text>" --raw',                 'Flat scored list (no markdown grouping)'],
			['node bin/ohara.js query "<text>" --raw --verbose',       'Flat list with score + source tags [fulltext+sumo+temporal…]'],
			['node bin/ohara.js query "<text>" --limit 10',            'Limit result count (default 20)'],
			['node bin/ohara.js query "<text>" --depth 3',             'Structural traversal depth (default 2)'],
		],
	},
	{
		title: 'Document management',
		cmds: [
			['npm run ohara:ls',                                       'List all ingested documents with IDs'],
			['node bin/ohara.js ls',                                   'Same'],
			['node bin/ohara.js rm <doc_id>',                         'Delete a document and all its nodes/edges'],
			['node bin/ohara.js verify <doc_id>',                     'Run integrity checks on an ingested document'],
			['npm run ohara:status',                                   'DB health + ingestion queue state'],
		],
	},
	{
		title: 'Export',
		cmds: [
			['npm run ohara:export',                                   'Export graph to Quartz-compatible Markdown → wiki/'],
			['npm run ohara:export:json',                              'Export raw JSON → doc_pipeline/collections/export.json'],
		],
	},
	{
		title: 'Admin queries  (require ArangoDB connection)',
		cmds: [
			['npm run admin',                                          'Run ALL admin queries'],
			['npm run admin:docs',                                     'List ingested documents with metadata'],
			['npm run admin:sections',                                 'List sections with document hierarchy'],
			['npm run admin:tags',                                     'SUMO tag frequency across all paragraphs'],
			['npm run admin:tag-coverage',                             '% of paragraphs with validated sumo_tags'],
			['npm run admin:missing-tags',                             'Paragraphs with unresolved candidate tags (alias gaps)'],
			['npm run admin:repair-stats',                             'LLM repair + cache stats from doc_pipeline/diagnostics/'],
			['npm run admin:missing-temporal',                         'Documents without published_date (candidates for backfill)'],
			['npm run admin:decay-distribution',                       'Decay class breakdown + temporal_confidence average'],
		],
	},
	{
		title: 'Backfill & maintenance',
		cmds: [
			['node scripts/backfill-temporal.js',                     'Dry-run: show docs missing temporal metadata'],
			['node scripts/backfill-temporal.js --write',             'Apply: call Gemini to extract + store temporal fields'],
			['node scripts/backfill-embeddings.js',                   'Dry-run: count paragraphs missing embeddings'],
			['node scripts/backfill-embeddings.js --write',           'Apply: generate text-embedding-004 vectors for paragraphs'],
			['node scripts/build-precedes-edges.js',                  'Dry-run: derive PRECEDES edges from temporal SIMILAR_TO edges'],
			['node scripts/build-precedes-edges.js --write',          'Apply: write PRECEDES edges to ArangoDB'],
			['node src/ingest/entity_dedup.js',                       'Merge duplicate entity nodes after batch ingest'],
			['node scripts/clean_noise_entities.js --dry-run',        'Preview opaque/noise entity removal'],
			['node scripts/clean_noise_entities.js',                  'Remove noise entities + repoint edges'],
		],
	},
	{
		title: 'Database setup',
		cmds: [
			['node scripts/db-init.js',                               'Create collections, ArangoSearch view, indexes (run once)'],
			['node scripts/admin-queries.js docs',                    'Verify data is present after init'],
		],
	},
	{
		title: 'Ontology',
		cmds: [
			['npm run build:sumo',                                     'Rebuild ontology/sumo_index.json + sumo_hierarchy.json from SUMO.owl'],
		],
	},
	{
		title: 'Tests',
		cmds: [
			['npm test',                                               'Run all tests (node built-in test runner, 25 tests)'],
		],
	},
	{
		title: 'MCP server',
		cmds: [
			['npm run ohara:mcp',                                      'Start Model Context Protocol server (for AI agent integrations)'],
		],
	},
	{
		title: 'Environment',
		cmds: [
			['node bin/ohara.js env list',                            'List all env vars stored in ArangoDB'],
			['node bin/ohara.js env get <KEY>',                       'Get a stored env var'],
			['node bin/ohara.js env set <KEY> <VALUE>',               'Set an env var in ArangoDB (persists across restarts)'],
			['node bin/ohara.js env unset <KEY>',                     'Remove a stored env var'],
		],
	},
];

const PAD = 52;

console.log();
console.log(b(`  Doc Ohara — Command Reference`));
console.log(d(`  Space-Time Graph · ArangoDB · Gemini · BM25 + SUMO + Entity + Vector`));
console.log();

for (const { title, cmds } of sections) {
	console.log(`  ${y(title)}`);
	for (const [cmd, desc] of cmds) {
		const padded = c(cmd).padEnd(PAD + (c('').length - ''.length));
		console.log(`    ${padded}  ${d(desc)}`);
	}
	console.log();
}

console.log(d(`  Dashboard: npm run dev → http://localhost:3000`));
console.log(d(`  Docs:      README.md`));
console.log();
