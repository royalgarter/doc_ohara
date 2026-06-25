#!/usr/bin/env node
// Doc_Ohara CLI (ohara 2.0) — multi-action front-end over the Space-Time Graph.
import dotenv from 'dotenv';
dotenv.config();
import { loadEnvFromDB, listEnv, getEnv, setEnv, unsetEnv } from '../src/db/env.js';
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { getArangoDBSimulator } from '../src/db/simulator.js';
import * as arangoClient from '../src/db/client.js';
import { RetrievalEngine } from '../src/retrieval.js';
import { getIngestionQueue } from '../src/ingest/queue.js';
import { runWorkerOnce } from '../src/ingest/worker.js';
import { QuartzExporter } from '../src/exporter.js';

const INPUT_DIR = 'doc_pipeline/input';
if (process.env.ARANGO_URL) await loadEnvFromDB();

const useRealDB = !!process.env.ARANGO_URL;

function emit(json, data, humanFn) {
	if (json) {
		console.log(JSON.stringify(data, null, 2));
	} else {
		humanFn(data);
	}
}

const program = new Command();
program
	.name('ohara')
	.description('Doc Ohara CLI — ingest, query, and manage the Space-Time Graph')
	.version('2.0.0');

program
	.command('ingest <path>')
	.description('Queue a document for processing')
	.option('--json', 'machine-readable output')
	.option('--force', 're-ingest even if the file hash already exists in the database')
	.action(async (filePath, opts) => {
		fs.mkdirSync(INPUT_DIR, { recursive: true });
		if (!fs.existsSync(filePath)) {
			const msg = `File not found: ${filePath}`;
			emit(opts.json, { success: false, error: msg }, () => console.error(chalk.red(`✖ ${msg}`)));
			process.exitCode = 1;
			return;
		}

		const filename = path.basename(filePath);
		const destPath = path.join(INPUT_DIR, filename);
		fs.copyFileSync(filePath, destPath);

		const queue = getIngestionQueue();
		const job = queue.add('ingestion', { filename, force: !!opts.force });

		if (!opts.json) {
			console.log(chalk.cyan(`Queued "${filename}" as job ${job.id}`));
			if (opts.force) console.log(chalk.dim('  --force: skipping duplicate-hash check'));
		}

		const aiKey = process.env.GEMINI_API_KEY;
		const processed = await runWorkerOnce(aiKey);
		const outcome = processed.find(p => p.jobId === job.id);

		emit(opts.json, { success: !!outcome?.success, job: queue.getJob(job.id) }, () => {
			if (outcome?.success) {
				const status = outcome.result?.ingestion_status;
				const u = outcome.result.llm_usage;
				const usageStr = u ? chalk.dim(` [prompt: ${u.prompt_tokens} | generated: ${u.candidates_tokens} | total: ${u.total_tokens} tokens, ${u.chunks} chunks${u.cache_hits ? ', ' + u.cache_hits + ' cached' : ''}]`) : '';
				if (status === 'partial') {
					const { completed_chunks, total_chunks } = outcome.result;
					console.log(chalk.yellow(`⚠ Partially ingested "${filename}": ${completed_chunks}/${total_chunks} chunks completed`) + usageStr);
					if (outcome.result.ingestion_error) console.log(chalk.dim(`  ${outcome.result.ingestion_error}`));
					console.log(chalk.dim('  Use --force to retry missing chunks.'));
					process.exitCode = 1;
				} else if (status === 'failed') {
					console.error(chalk.red(`✖ Ingestion failed: ${outcome.result.ingestion_error || outcome.error}`));
					process.exitCode = 1;
				} else {
					console.log(chalk.green(`✔ Ingested ${filename}: ${outcome.result.documents} document(s), ${outcome.result.nodes} node(s)`) + usageStr);
				}
			} else if (outcome?.error?.includes('ALREADY_INGESTED')) {
				console.log(chalk.yellow(`⚠ Skipped "${filename}": already ingested. Use --force to re-ingest.`));
			} else {
				console.error(chalk.red(`✖ Ingestion failed: ${outcome?.error || 'unknown error'}`));
				process.exitCode = 1;
			}
		});
	});

program
	.command('query <text>')
	.description('5-phase hybrid search: BM25 + SUMO tags + entity graph + structural traversal')
	.option('--json', 'machine-readable output')
	.option('--depth <n>', 'structural traversal depth', '2')
	.option('--limit <n>', 'max results to return', '20')
	.option('--expand-depth <n>', 'cross-doc SIMILAR_TO hop depth', '1')
	.option('--cross-doc-limit <n>', 'max cross-doc paragraphs returned')
	.option('--cross-doc-weight <n>', 'score weight for cross-doc edge results')
	.option('--verbose', 'show per-result source phases and scores')
	.option('--raw', 'show flat scored list instead of reconstructed Markdown')
	.option('--tiers', 'show Principal / Integrity / Explorer tier breakdown instead of flat results')
	.action(async (text, opts) => {
		let retrievalDB;
		if (useRealDB) {
			await arangoClient.initArangoClient();
			retrievalDB = { executeAQL: (q, b) => arangoClient.executeAQL(q, b) };
		} else {
			const sim = getArangoDBSimulator();
			retrievalDB = {
				executeAQL: (q, b) => {
					const r = sim.executeAQL(q, b);
					return Promise.resolve(r?.results || []);
				},
			};
		}

		const engine = new RetrievalEngine(retrievalDB);

		if (!opts.json) {
			const inputType = text.trim().split(/\s+/).length <= 3 ? 'keyword'
				: text.trim().split(/\s+/).length <= 30 ? 'phrase' : 'paragraph';
			console.log(chalk.dim(`Input type: ${inputType}${inputType === 'paragraph' ? ' (Gemini extraction)' : ''}`));
		}

		const result = await engine.query(text, {
			depth: parseInt(opts.depth, 10),
			limit: parseInt(opts.limit, 10),
			expandDepth: parseInt(opts.expandDepth, 10),
			crossDocLimit: opts.crossDocLimit ? parseInt(opts.crossDocLimit, 10) : undefined,
			crossDocWeight: opts.crossDocWeight ? parseFloat(opts.crossDocWeight) : undefined,
		});

		const markdown = opts.json || opts.raw || opts.tiers ? null : await engine.formatAsMarkdown(result.results || []);
		const principalMarkdown = opts.tiers && !opts.json
			? await engine.formatAsMarkdown((result.tiers?.principal || []).map(e => ({ node: e.node })))
			: null;
		const integrityMarkdown = opts.tiers && !opts.json
			? await engine.formatAsMarkdown((result.tiers?.integrity || []).map(e => ({ node: e.node })))
			: null;

		emit(opts.json, { success: true, ...result }, async () => {
			const { results = [], processedQuery, tiers } = result;

			// Always print the query summary header
			console.log('');
			console.log(chalk.bold(`Results for: ${chalk.white(`"${text}"`)}`));
			if (processedQuery?.keywords?.length) {
				console.log(chalk.dim(`  keywords: ${processedQuery.keywords.join(', ')}`));
			}
			if (processedQuery?.entityHints?.length) {
				console.log(chalk.dim(`  entity hints: ${processedQuery.entityHints.map(h => typeof h === 'object' ? `${h.slug}(${h.type})` : h).join(', ')}`));
			}
			if (processedQuery?.sumoHints?.length) {
				console.log(chalk.dim(`  SUMO hints: ${processedQuery.sumoHints.join(', ')}`));
			}
			console.log(chalk.dim(`  ${results.length} result(s) — depth=${opts.depth} limit=${opts.limit}`));
			console.log('');

			if (results.length === 0) {
				console.log(chalk.yellow('  (no matches)'));
				return;
			}

			if (opts.tiers) {
				console.log(chalk.bold.cyan('━━ Principal ━━'));
				if (!tiers?.principal?.length) {
					console.log(chalk.dim('  (no corroborated-across-sources results)'));
				} else {
					if (opts.verbose) {
						tiers.principal.forEach(({ node, score, sources }) => {
							console.log(chalk.dim(`  [${chalk.green(score.toFixed(3))} ${(sources||[]).join('+')}] ${node._id}`));
						});
					}
					console.log(principalMarkdown);
				}
				console.log('');
				console.log(chalk.bold.cyan('━━ Integrity ━━'));
				if (!tiers?.integrity?.length) {
					console.log(chalk.dim('  (no verified results)'));
				} else {
					if (opts.verbose) {
						tiers.integrity.forEach(({ node, score, provenance }) => {
							const prov = (provenance || []).map(p => `${p.phase}${p.document_id ? `@${p.document_id}` : ''}`).join(', ');
							console.log(chalk.dim(`  [${chalk.green((score||0).toFixed(3))}] ${node._id} — provenance: ${prov}`));
						});
					}
					console.log(integrityMarkdown);
				}
				console.log('');
				console.log(chalk.bold.cyan('━━ Explorer ━━'));
				const frontier = tiers?.explorer?.frontier || [];
				if (!frontier.length) {
					console.log(chalk.dim(`  (no frontier candidates — ${tiers?.explorer?.stopped_reason || 'unknown'})`));
				} else {
					frontier.forEach((f, i) => {
						console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.green((f.score||0).toFixed(3))}  ${f.edge_verb || 'related to'} — ${f.edge_summary || f.document_id}`);
					});
					console.log(chalk.dim(`  stopped: ${tiers?.explorer?.stopped_reason}`));
				}
				return;
			}

			if (opts.raw) {
				// Flat scored list
				results.forEach(({ node, score, sources }, i) => {
					const label = node.title || node.content?.replace(/\s+/g, ' ').slice(0, 100) || node._id;
					const sourceTag = opts.verbose ? chalk.dim(` [${(sources || []).join('+')}]`) : '';
					const rank = chalk.dim(`${String(i + 1).padStart(2)}.`);
					console.log(`${rank} ${chalk.green(score.toFixed(3))}  ${label}${sourceTag}`);
					if (opts.verbose && node._id) console.log(chalk.dim(`       id: ${node._id}`));
				});
			} else {
				// Reconstructed Markdown grouped by document → section
				if (opts.verbose) {
					// prepend score/source annotation per paragraph in verbose mode
					results.forEach(({ node, score, sources }) => {
						if (node?._id) console.log(chalk.dim(`  [${chalk.green(score.toFixed(3))} ${(sources||[]).join('+')}] ${node._id}`));
					});
					console.log('');
				}
				console.log(markdown);
			}
		});
	});

program
	.command('ls')
	.description('List all ingested documents')
	.option('--json', 'machine-readable output')
	.action(async (opts) => {
		let docs;
		if (useRealDB) {
			docs = await arangoClient.listDocuments();
		} else {
			docs = getArangoDBSimulator().getState().documents;
		}
		emit(opts.json, { success: true, documents: docs }, () => {
			if (docs.length === 0) console.log(chalk.yellow('No documents ingested yet.'));
			docs.forEach(d => {
				const hash = d.file_hash ? chalk.dim(` [${d.file_hash.slice(0, 10)}…]`) : '';
				console.log(`${chalk.cyan(d._key)}  ${d.title}  ${chalk.dim(`(${d.parser_engine}, ${d.file_size})`)}${hash}`);
			});
		});
	});

program
	.command('verify <doc_id>')
	.description('Run integrity checks on an ingested document')
	.option('--json', 'machine-readable output')
	.option('--fix', 'attempt to repair recoverable issues (missing edges)')
	.action(async (docId, opts) => {
		if (!useRealDB) {
			console.error(chalk.red('✖ verify requires a real ArangoDB connection (ARANGO_URL not set)'));
			process.exitCode = 1; return;
		}
		const db = await arangoClient.initArangoClient();

		// ── Fetch the document ────────────────────────────────────────────────
		const doc = await db.query('FOR d IN documents FILTER d._key == @k RETURN d', { k: docId })
			.then(c => c.next()).catch(() => null);
		if (!doc) {
			console.error(chalk.red(`✖ Document "${docId}" not found`));
			process.exitCode = 1; return;
		}

		const issues   = [];   // { severity: 'error'|'warn', code, message, detail? }
		const stats    = {};
		const repairs  = [];

		function fail(code, message, detail)  { issues.push({ severity: 'error', code, message, detail }); }
		function warn(code, message, detail)  { issues.push({ severity: 'warn',  code, message, detail }); }

		// ── 1. Fetch all nodes for this document ─────────────────────────────
		const [sections, paragraphs, tables] = await Promise.all([
			db.query('FOR s IN sections  FILTER s.document_id == @k RETURN s', { k: docId }).then(c => c.all()),
			db.query('FOR p IN paragraphs FILTER p.document_id == @k RETURN p', { k: docId }).then(c => c.all()),
			db.query('FOR t IN tables    FILTER t.document_id == @k RETURN t', { k: docId }).then(c => c.all()),
		]);

		stats.sections   = sections.length;
		stats.paragraphs = paragraphs.length;
		stats.tables     = tables.length;
		stats.nodes      = sections.length + paragraphs.length + tables.length;

		if (stats.nodes === 0) {
			fail('NO_NODES', 'Document has no child nodes at all — ingestion may have failed');
		}

		// ── 2. Fetch all edges touching any node of this document ────────────
		const allNodeIds = [
			`documents/${docId}`,
			...sections.map(s => s._id),
			...paragraphs.map(p => p._id),
			...tables.map(t => t._id),
		];
		const edges = await db.query(
			'FOR e IN edges FILTER e._from IN @ids OR e._to IN @ids RETURN e',
			{ ids: allNodeIds }
		).then(c => c.all());

		stats.edges = edges.length;

		const edgeSet  = new Set(edges.map(e => `${e._from}→${e._to}→${e.relation}`));
		const fromMap  = new Map(); // nodeId → [edges where _from == nodeId]
		const toMap    = new Map(); // nodeId → [edges where _to   == nodeId]
		for (const e of edges) {
			if (!fromMap.has(e._from)) fromMap.set(e._from, []);
			if (!toMap.has(e._to))     toMap.set(e._to, []);
			fromMap.get(e._from).push(e);
			toMap.get(e._to).push(e);
		}

		// ── 3. Duplicate edges ───────────────────────────────────────────────
		const edgeSigs = edges.map(e => `${e._from}→${e._to}→${e.relation}`);
		const dupSigs  = edgeSigs.filter((s, i) => edgeSigs.indexOf(s) !== i);
		if (dupSigs.length > 0) {
			fail('DUPLICATE_EDGES', `${dupSigs.length} duplicate edge(s) found`, dupSigs.slice(0, 5));
		}

		// ── 4. Section hierarchy checks ──────────────────────────────────────
		const secById = new Map(sections.map(s => [s._id, s]));

		// 4a. Every section must have exactly one incoming HAS_CHILD edge
		const missingParentEdge = [];
		const fixEdges = [];
		for (const sec of sections) {
			const incoming = (toMap.get(sec._id) || []).filter(e => e.relation === 'HAS_CHILD');
			if (incoming.length === 0) {
				missingParentEdge.push(sec._id);
				// Determine what the parent edge should be
				const parentHandle = sec.parent_section_id
					? secById.get(sec.parent_section_id)?._id || null
					: null;
				fixEdges.push({ _from: parentHandle || `documents/${docId}`, _to: sec._id });
			} else if (incoming.length > 1) {
				warn('MULTI_PARENT_EDGE', `Section ${sec._id} has ${incoming.length} incoming HAS_CHILD edges`);
			}
		}
		if (missingParentEdge.length > 0) {
			fail('MISSING_SECTION_PARENT_EDGE',
				`${missingParentEdge.length} section(s) have no incoming HAS_CHILD edge`,
				missingParentEdge.slice(0, 10));
			if (opts.fix) {
				for (const e of fixEdges) {
					await arangoClient.insertEdge({ ...e, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(() => {});
					repairs.push(`Added HAS_CHILD ${e._from} → ${e._to}`);
				}
			}
		}

		// 4b. parent_section_id field (if set and looks like an ArangoDB _id) must resolve to a real section
		const danglingParentRef = sections.filter(s =>
			s.parent_section_id &&
			s.parent_section_id.startsWith('sections/') &&
			!secById.has(s.parent_section_id)
		);
		// Legacy docs may store internal okf_node_ IDs — warn instead of error
		const legacyParentRef = sections.filter(s =>
			s.parent_section_id && !s.parent_section_id.startsWith('sections/')
		);
		if (danglingParentRef.length > 0) {
			fail('DANGLING_PARENT_SECTION_ID',
				`${danglingParentRef.length} section(s) have parent_section_id pointing to a non-existent section`,
				danglingParentRef.map(s => ({ id: s._id, parent_section_id: s.parent_section_id })).slice(0, 5));
		}
		if (legacyParentRef.length > 0) {
			warn('LEGACY_PARENT_SECTION_ID',
				`${legacyParentRef.length} section(s) have legacy internal parent_section_id (re-ingest with --force to fix)`);
		}

		// 4c. Level continuity — no section should jump more than 1 level below its parent
		let levelGaps = 0;
		for (const sec of sections) {
			if (!sec.parent_section_id || !sec.parent_section_id.startsWith('sections/')) continue;
			const parent = secById.get(sec.parent_section_id);
			if (parent && sec.level - parent.level > 1) levelGaps++;
		}
		if (levelGaps > 0) {
			warn('LEVEL_GAP', `${levelGaps} section(s) jump more than 1 level below their parent (e.g. L1 → L3)`);
		}

		// 4d. Sections with no children at all (no HAS_CHILD outgoing, no paragraphs)
		const leafSections = sections.filter(s => {
			const outgoing = (fromMap.get(s._id) || []).filter(e => e.relation === 'HAS_CHILD');
			return outgoing.length === 0;
		});
		stats.leaf_sections = leafSections.length;
		if (leafSections.length > 0 && leafSections.length === sections.length) {
			warn('ALL_SECTIONS_LEAF', 'Every section is a leaf — no section has children. Hierarchy may not have been wired.');
		}

		// ── 5. Paragraph / table edge checks ─────────────────────────────────
		const missingBelongsTo = [];
		const missingSectionLink = [];

		for (const p of [...paragraphs, ...tables]) {
			const out = fromMap.get(p._id) || [];
			const hasBelongsTo = out.some(e => e.relation === 'BELONGS_TO');
			if (!hasBelongsTo) missingBelongsTo.push(p._id);

			if (p.section_id) {
				const inc = toMap.get(p._id) || [];
				const hasSectionChild = inc.some(e => e.relation === 'HAS_CHILD' && e._from === p.section_id);
				if (!hasSectionChild) missingSectionLink.push({ node: p._id, section: p.section_id });
			}
		}
		if (missingBelongsTo.length > 0) {
			fail('MISSING_BELONGS_TO',
				`${missingBelongsTo.length} paragraph/table(s) missing BELONGS_TO edge to document`,
				missingBelongsTo.slice(0, 10));
			if (opts.fix) {
				for (const nodeId of missingBelongsTo) {
					await arangoClient.insertEdge({ _from: nodeId, _to: `documents/${docId}`, relation: 'BELONGS_TO', type: 'BELONGS_TO' }).catch(() => {});
					repairs.push(`Added BELONGS_TO ${nodeId} → documents/${docId}`);
				}
			}
		}
		if (missingSectionLink.length > 0) {
			fail('MISSING_SECTION_HAS_CHILD',
				`${missingSectionLink.length} paragraph/table(s) have section_id set but no HAS_CHILD edge from that section`,
				missingSectionLink.slice(0, 10));
		}

		// ── 6. Orphaned nodes (document_id matches but no edges at all) ──────
		const orphans = [...sections, ...paragraphs, ...tables].filter(n =>
			!(fromMap.has(n._id)) && !(toMap.has(n._id))
		);
		if (orphans.length > 0) {
			fail('ORPHANED_NODES', `${orphans.length} node(s) have no edges at all`, orphans.map(n => n._id).slice(0, 10));
		}

		// ── 7. Dead edges (point to nodes not in this document's set) ────────
		const knownIds = new Set(allNodeIds);
		const deadEdges = edges.filter(e => !knownIds.has(e._from) && !knownIds.has(e._to));
		if (deadEdges.length > 0) {
			warn('DEAD_EDGES', `${deadEdges.length} edge(s) reference nodes outside this document`, deadEdges.map(e => e._id).slice(0, 5));
		}

		// ── 8. Empty content ─────────────────────────────────────────────────
		// Figures have no extractable text — exclude them from this check
		const textParas    = paragraphs.filter(p => p.node_type !== 'Figure');
		const emptyParas   = textParas.filter(p => !p.content || p.content.trim().length === 0);
		stats.text_paragraphs  = textParas.length;
		stats.empty_paragraphs = emptyParas.length;
		if (textParas.length > 0) {
			const emptyRatio = emptyParas.length / textParas.length;
			if (emptyRatio > 0.5) {
				fail('EMPTY_PARAGRAPHS',
					`${emptyParas.length}/${textParas.length} text paragraphs (${Math.round(emptyRatio * 100)}%) have empty content — possible extraction failure`);
			} else if (emptyParas.length > 0) {
				warn('EMPTY_PARAGRAPHS', `${emptyParas.length} paragraph(s) have empty content`);
			}
		}

		// ── 9. Content length vs original file ───────────────────────────────
		const totalContentLen = paragraphs.reduce((sum, p) => sum + (p.content?.length || 0), 0);
		stats.total_content_chars = totalContentLen;

		// Try to find the intermediate markdown (text extraction output) to compare
		// against extracted content. We use the markdown, not the original PDF/binary,
		// because binary files contain fonts/images/compression that inflate byte count.
		const srcFile = doc.source_file;
		const rawOutputBase = 'doc_pipeline/raw_output';
		let originalLen = null;
		// Look for <srcFile>.md or <srcFile>/<srcFile without ext>.md
		const mdCandidates = [
			path.join(rawOutputBase, srcFile.replace(/\.[^.]+$/, '.md')),
			path.join(rawOutputBase, srcFile, srcFile.replace(/\.[^.]+$/, '.md')),
			path.join(rawOutputBase, srcFile),
		];
		for (const candidate of mdCandidates) {
			const st = fs.existsSync(candidate) && fs.statSync(candidate);
			if (st && st.isFile()) {
				originalLen = st.size;
				stats.original_file_bytes = originalLen;
				stats.original_file_path  = candidate;
				break;
			}
		}
		// Fall back to original source file only if it is plaintext (not a binary format)
		if (originalLen === null) {
			for (const dir of ['doc_pipeline/input', 'sample']) {
				const candidate = path.join(dir, srcFile);
				if (fs.existsSync(candidate) && /\.(md|txt)$/i.test(srcFile)) {
					originalLen = fs.statSync(candidate).size;
					stats.original_file_bytes = originalLen;
					stats.original_file_path  = candidate;
					break;
				}
			}
		}

		if (originalLen !== null) {
			// Expect extracted content to be 40–110% of the markdown text
			const ratio = totalContentLen / originalLen;
			stats.content_coverage_ratio = Math.round(ratio * 100) + '%';
			if (ratio < 0.3) {
				fail('LOW_CONTENT_COVERAGE',
					`Extracted text (${totalContentLen} chars) is only ${Math.round(ratio * 100)}% of the parsed markdown (${originalLen} bytes) — expected ≥30%`);
			} else if (ratio < 0.5) {
				warn('PARTIAL_CONTENT_COVERAGE',
					`Extracted text is ${Math.round(ratio * 100)}% of parsed markdown — may indicate missing sections`);
			}
		} else {
			warn('ORIGINAL_FILE_NOT_FOUND', `Could not find parsed markdown for "${srcFile}" to compare content length`);
		}

		// ── 10. Markdown paragraph spot-check (random 10) ────────────────────
		if (stats.original_file_path) {
			const mdText = fs.readFileSync(stats.original_file_path, 'utf-8');
			// Split on blank lines, keep blocks that look like real prose (≥60 chars, not a heading/fence)
			const mdParas = mdText.split(/\n{2,}/)
				.map(b => b.trim())
				.filter(b => b.length >= 60 && !b.startsWith('#') && !b.startsWith('```') && !b.startsWith('|') && !b.startsWith('---'));

			if (mdParas.length >= 5) {
				// Pick 10 random paragraphs (or fewer if not enough)
				const sample = [];
				const pool = [...mdParas];
				const n = Math.min(10, pool.length);
				for (let i = 0; i < n; i++) {
					const idx = Math.floor(Math.random() * pool.length);
					sample.push(pool.splice(idx, 1)[0]);
				}

				// Build a flat string of all DB paragraph content for substring search
				const dbContent = paragraphs.map(p => p.content || '').join('\n');

				let hits = 0;
				const misses = [];
				for (const mdPara of sample) {
					// Use a 40-char probe from the middle of the block (avoids heading noise at start)
					const probe = mdPara.replace(/\s+/g, ' ').slice(20, 60).trim();
					if (probe.length >= 20 && dbContent.includes(probe)) {
						hits++;
					} else {
						misses.push(probe);
					}
				}

				stats.spot_check = `${hits}/${n} matched`;
				// Note: ~20-30% misses are expected — TOC lines, figure captions with markdown
				// syntax, and numbered list items don't match verbatim against stored content.
				if (hits < Math.ceil(n * 0.4)) {
					fail('SPOT_CHECK_FAILED',
						`Only ${hits}/${n} sampled markdown paragraphs found in DB. First miss: "${misses[0]}"`);
				} else if (hits < Math.ceil(n * 0.6)) {
					warn('SPOT_CHECK_PARTIAL',
						`${hits}/${n} sampled markdown paragraphs found in DB — some content may be missing`);
				}
			}
		}

		// ── 11. NEXT_SIBLING chain sanity ────────────────────────────────────
		const multiNextSibling = sections.filter(s => {
			const out = (fromMap.get(s._id) || []).filter(e => e.relation === 'NEXT_SIBLING');
			return out.length > 1;
		});
		if (multiNextSibling.length > 0) {
			warn('MULTI_NEXT_SIBLING', `${multiNextSibling.length} section(s) have more than one outgoing NEXT_SIBLING edge`);
		}

		// ── 11. SUMO tag coverage ────────────────────────────────────────────
		const taggedParas  = paragraphs.filter(p => (p.sumo_tags || []).length > 0).length;
		stats.tagged_paragraphs = taggedParas;
		stats.tag_coverage = paragraphs.length > 0
			? Math.round(taggedParas / paragraphs.length * 100) + '%'
			: 'N/A';
		if (paragraphs.length > 0 && taggedParas === 0) {
			warn('NO_SUMO_TAGS', 'No paragraphs have SUMO tags — semantic tagging may not have run');
		}

		// ── Result ────────────────────────────────────────────────────────────
		const errors = issues.filter(i => i.severity === 'error');
		const warns  = issues.filter(i => i.severity === 'warn');
		const passed = errors.length === 0;

		emit(opts.json,
			{ success: passed, doc: { _key: doc._key, title: doc.title }, stats, issues, repairs },
			() => {
				console.log('');
				console.log(chalk.bold(`Document: ${chalk.cyan(doc.title || doc.source_file)} [${docId}]`));
				console.log(chalk.dim(`  source: ${doc.source_file}  hash: ${doc.file_hash?.slice(0,12)}…`));
				console.log('');

				// Stats table
				const statLines = [
					['Sections',         stats.sections],
					['Paragraphs',       `${stats.paragraphs} (${stats.text_paragraphs} text, ${stats.paragraphs - stats.text_paragraphs} figures)`],
					['Tables',           stats.tables],
					['Total nodes',      stats.nodes],
					['Edges',            stats.edges],
					['Leaf sections',    stats.leaf_sections],
					['Empty paragraphs', `${stats.empty_paragraphs} / ${stats.text_paragraphs} text nodes`],
					['Tagged paragraphs',`${stats.tagged_paragraphs} (${stats.tag_coverage})`],
					['Content chars',    stats.total_content_chars?.toLocaleString()],
				];
				if (stats.original_file_bytes) {
					statLines.push(['Original file', `${(stats.original_file_bytes / 1024).toFixed(1)} KB  →  ${stats.content_coverage_ratio} coverage`]);
				}
				if (stats.spot_check) {
					statLines.push(['Spot check', stats.spot_check + ' paragraphs found in DB']);
				}
				for (const [k, v] of statLines) {
					console.log(`  ${chalk.dim(k.padEnd(22))} ${chalk.white(v)}`);
				}
				console.log('');

				if (issues.length === 0) {
					console.log(chalk.green('✔ All integrity checks passed'));
				} else {
					for (const issue of issues) {
						const icon  = issue.severity === 'error' ? chalk.red('✖') : chalk.yellow('⚠');
						const color = issue.severity === 'error' ? chalk.red : chalk.yellow;
						console.log(`${icon} [${color(issue.code)}] ${issue.message}`);
						if (issue.detail && Array.isArray(issue.detail)) {
							for (const d of issue.detail.slice(0, 3)) {
								console.log(chalk.dim(`    ${typeof d === 'string' ? d : JSON.stringify(d)}`));
							}
							if (issue.detail.length > 3) console.log(chalk.dim(`    … and ${issue.detail.length - 3} more`));
						}
					}
					console.log('');
					console.log(`${errors.length} error(s)  ${warns.length} warning(s)`);
				}

				if (repairs.length > 0) {
					console.log('');
					console.log(chalk.cyan(`🔧 ${repairs.length} repair(s) applied:`));
					for (const r of repairs) console.log(chalk.dim(`  ${r}`));
				}

				if (!passed) process.exitCode = 1;
			}
		);
	});

program
	.command('rm <doc_id>')
	.description('Delete a document and all its associated nodes/edges')
	.option('--json', 'machine-readable output')
	.action(async (docId, opts) => {
		let deleted;
		if (useRealDB) {
			deleted = await arangoClient.deleteDocumentAndNodes(docId).catch(() => false);
		} else {
			deleted = getArangoDBSimulator().deleteDocument(docId);
		}
		emit(opts.json, { success: deleted }, () => {
			if (deleted) console.log(chalk.green(`✔ Deleted document "${docId}" and its graph nodes/edges.`));
			else {
				console.error(chalk.red(`✖ Document "${docId}" not found.`));
				process.exitCode = 1;
			}
		});
	});

program
	.command('status')
	.description('Check database health and ingestion queue state')
	.option('--json', 'machine-readable output')
	.action(async (opts) => {
		let dbStats;
		if (useRealDB) {
			const stats = await arangoClient.getStats();
			dbStats = { ok: true, source: 'arangodb', ...stats };
		} else {
			const state = getArangoDBSimulator().getState();
			dbStats = {
				ok: true, source: 'simulator',
				documents: state.documents.length, sections: state.sections.length,
				paragraphs: state.paragraphs.length, tables: state.tables.length,
				edges: state.edges.length,
			};
		}
		const queueStats = getIngestionQueue().stats();
		emit(opts.json, { success: true, database: dbStats, queue: queueStats }, () => {
			console.log(chalk.bold('Database:'), chalk.green('OK'),
				chalk.dim(`[${dbStats.source}]`),
				`(${dbStats.documents} docs, ${dbStats.sections} sections, ${dbStats.paragraphs} paragraphs, ${dbStats.edges} edges)`);
			console.log(chalk.bold('Queue:'), `waiting=${queueStats.waiting} active=${queueStats.active} completed=${queueStats.completed} failed=${queueStats.failed}`);
		});
	});

program
	.command('export')
	.description('Trigger the wiki exporter')
	.option('--format <format>', 'quartz or json', 'quartz')
	.option('--json', 'machine-readable output')
	.action(async (opts) => {
		const db = useRealDB ? arangoClient.realDBAdapter() : getArangoDBSimulator();
		if (opts.format === 'json') {
			const state = await db.getState();
			const outPath = path.join(process.cwd(), 'doc_pipeline/collections/export.json');
			fs.writeFileSync(outPath, JSON.stringify(state, null, 2), 'utf-8');
			emit(opts.json, { success: true, path: outPath }, () => console.log(chalk.green(`✔ Exported JSON to ${outPath}`)));
			return;
		}

		const exporter = new QuartzExporter(db, 'wiki');
		await exporter.export();
		const outPath = path.join(process.cwd(), 'wiki');
		emit(opts.json, { success: true, path: outPath }, () => console.log(chalk.green(`✔ Exported Quartz wiki to ${outPath}`)));
	});

// ── env command ──────────────────────────────────────────────────────────────
const envCmd = program.command('env').description('Manage environment variables stored in ArangoDB');

envCmd
	.command('list')
	.description('List all env vars stored in ArangoDB')
	.option('--json', 'machine-readable output')
	.action(async (opts) => {
		const entries = await listEnv();
		emit(opts.json, { success: true, env: entries }, () => {
			if (entries.length === 0) {
				console.log(chalk.yellow('No env vars stored in ArangoDB yet.'));
			} else {
				for (const { key, value } of entries) {
					const masked = key.toLowerCase().includes('key') || key.toLowerCase().includes('pass') || key.toLowerCase().includes('secret')
						? value.slice(0, 4) + '…'
						: value;
					console.log(`${chalk.cyan(key.padEnd(32))} ${masked}`);
				}
			}
		});
	});

envCmd
	.command('get <key>')
	.description('Get a single env var from ArangoDB')
	.action(async (key) => {
		const value = await getEnv(key);
		if (value === null) {
			console.log(chalk.yellow(`"${key}" is not set in ArangoDB.`));
			process.exitCode = 1;
		} else {
			console.log(value);
		}
	});

envCmd
	.command('set <key> <value>')
	.description('Set an env var in ArangoDB (and immediately into process.env)')
	.action(async (key, value) => {
		try {
			await setEnv(key, value);
			console.log(chalk.green(`✔ Set ${key}`));
		} catch (err) {
			console.error(chalk.red(`✖ ${err.message}`));
			process.exitCode = 1;
		}
	});

envCmd
	.command('unset <key>')
	.description('Remove an env var from ArangoDB')
	.action(async (key) => {
		await unsetEnv(key);
		console.log(chalk.green(`✔ Unset ${key}`));
	});

program.parse();
