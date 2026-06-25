#!/usr/bin/env node
/**
 * Backfill temporal metadata for documents that were ingested before Phase A.
 * Makes one small Gemini call per document using the document's first few paragraphs
 * as context — far cheaper than full re-ingest.
 *
 * Usage:
 *   node scripts/backfill-temporal.js          # dry-run (show what would change)
 *   node scripts/backfill-temporal.js --write  # apply updates to ArangoDB
 */
import dotenv from 'dotenv';
dotenv.config();
import { loadEnvFromDB } from '../src/db/env.js';
import { initArangoClient } from '../src/db/client.js';
import { GoogleGenAI } from '@google/genai';

if (process.env.ARANGO_URL) await loadEnvFromDB();

const DRY_RUN = !process.argv.includes('--write');
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const TEMPORAL_PROMPT = `You are a metadata extractor. Given document title and excerpt, output ONLY a JSON object with these exact fields:
{
  "published_date": string | null,
  "temporal_coverage_start": string | null,
  "temporal_coverage_end": string | null,
  "temporal_granularity": "day"|"month"|"year"|"decade"|"century",
  "temporal_confidence": number,
  "decay_class": "EVERGREEN"|"SCHOLARLY"|"CURRENT"|"EPHEMERAL"
}

Rules:
- published_date: when the document was written/published. Format "YYYY-MM-DD", "YYYY-MM", or "YYYY". null if unknown.
- temporal_coverage: the period the CONTENT describes (may differ from publication date).
- temporal_confidence: 0.0–1.0 confidence in your published_date estimate.
- decay_class: EVERGREEN=timeless laws/classics/math, SCHOLARLY=papers/textbooks, CURRENT=news/blogs, EPHEMERAL=social/changelogs.

Output only the JSON object, no fences, no commentary.

`;

async function extractTemporalMetadata(ai, title, excerpt) {
	const prompt = TEMPORAL_PROMPT + `Title: ${title}\n\nExcerpt:\n${excerpt.slice(0, 2000)}`;
	try {
		const result = await ai.models.generateContent({
			model: GEMINI_MODEL,
			contents: prompt,
			config: { serviceTier: 'flex' },
		});
		const text = (result.text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
		return JSON.parse(text);
	} catch (err) {
		console.error(`  Gemini error: ${err.message}`);
		return null;
	}
}

async function main() {
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
	const db = await initArangoClient();
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	// Find docs missing published_date
	const cursor = await db.query(`
		FOR d IN documents
		FILTER d.published_date == null
		RETURN { id: d._id, key: d._key, title: d.title }
	`);
	const docs = await cursor.all();

	if (!docs.length) {
		console.log('All documents already have temporal metadata.');
		return;
	}

	console.log(`Found ${docs.length} document(s) missing temporal metadata.`);
	if (DRY_RUN) console.log('DRY RUN — pass --write to apply.\n');

	for (const doc of docs) {
		console.log(`\n[${doc.key}] ${doc.title}`);

		// Fetch first ~5 paragraphs as context
		const paraCursor = await db.query(`
			FOR p IN paragraphs
			FILTER p.document_id == @key
			FILTER LENGTH(p.content) > 50
			SORT p._key ASC
			LIMIT 5
			RETURN p.content
		`, { key: doc.key });
		const paras = await paraCursor.all();
		const excerpt = paras.join('\n\n');

		if (!excerpt) {
			console.log('  (no paragraph content found — skipping)');
			continue;
		}

		const meta = await extractTemporalMetadata(ai, doc.title || '', excerpt);
		if (!meta) { console.log('  (extraction failed — skipping)'); continue; }

		console.log(`  published_date:    ${meta.published_date}`);
		console.log(`  decay_class:       ${meta.decay_class}`);
		console.log(`  temporal_confidence: ${meta.temporal_confidence}`);

		if (!DRY_RUN) {
			await db.query(`
				UPDATE @key WITH {
					published_date: @published_date,
					temporal_coverage_start: @temporal_coverage_start,
					temporal_coverage_end: @temporal_coverage_end,
					temporal_granularity: @temporal_granularity,
					temporal_confidence: @temporal_confidence,
					temporal_needs_review: true,
					decay_class: @decay_class,
					effective_decay_class: @decay_class
				} IN documents
			`, {
				key: doc.key,
				published_date: meta.published_date ?? null,
				temporal_coverage_start: meta.temporal_coverage_start ?? null,
				temporal_coverage_end: meta.temporal_coverage_end ?? null,
				temporal_granularity: meta.temporal_granularity || 'year',
				temporal_confidence: meta.temporal_confidence ?? null,
				decay_class: meta.decay_class || 'SCHOLARLY',
			});
			console.log('  ✓ updated');
		}
	}

	if (DRY_RUN && docs.length) {
		console.log('\nRe-run with --write to apply changes.');
	}
}

main().catch(err => { console.error(err.message); process.exit(1); });
