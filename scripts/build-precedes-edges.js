#!/usr/bin/env node
/**
 * Derive PRECEDES edges from existing SIMILAR_TO edges that carry temporal_relation.
 *
 * Logic:
 *   - For each SIMILAR_TO edge where temporal_relation IN ['extends', 'supersedes']
 *     AND both documents have published_date:
 *     → The chronologically earlier doc PRECEDES the later doc.
 *   - If temporal_relation = 'extends': later doc likely builds on earlier doc.
 *   - If temporal_relation = 'supersedes': the edge._from supersedes the edge._to
 *     (by convention from pipeline.js enrichment), so _from is newer.
 *
 * PRECEDES edge schema:
 *   { _from: "documents/A", _to: "documents/B", relation: "PRECEDES",
 *     type: "PRECEDES", derived_from: edgeId, reason: "extends|supersedes" }
 *
 * Usage:
 *   node scripts/build-precedes-edges.js          # dry-run
 *   node scripts/build-precedes-edges.js --write  # apply
 */
import dotenv from 'dotenv';
dotenv.config();
import { loadEnvFromDB } from '../src/db/env.js';
import { initArangoClient } from '../src/db/client.js';

if (process.env.ARANGO_URL) await loadEnvFromDB();

const DRY_RUN = !process.argv.includes('--write');

async function main() {
	const db = await initArangoClient();

	// Fetch SIMILAR_TO edges with temporal_relation
	const edgeCursor = await db.query(`
		FOR e IN edges
		FILTER e.type == "SIMILAR_TO"
		FILTER e.temporal_relation IN ["extends", "supersedes"]
		RETURN e
	`);
	const similarEdges = await edgeCursor.all();

	if (!similarEdges.length) {
		console.log('No SIMILAR_TO edges with temporal_relation found. Ingest more documents first.');
		return;
	}

	console.log(`Found ${similarEdges.length} SIMILAR_TO edge(s) with temporal ordering.`);
	if (DRY_RUN) console.log('DRY RUN — pass --write to apply.\n');

	// Fetch all published_dates once
	const docCursor = await db.query(`
		FOR d IN documents
		FILTER d.published_date != null
		RETURN { id: d._id, date: d.published_date }
	`);
	const docDates = await docCursor.all();
	const dateMap = new Map(docDates.map(d => [d.id, d.date]));

	// Check for existing PRECEDES edges to avoid duplicates
	const existingCursor = await db.query(`
		FOR e IN edges
		FILTER e.type == "PRECEDES"
		RETURN { from: e._from, to: e._to }
	`);
	const existingEdges = await existingCursor.all();
	const existingSet = new Set(existingEdges.map(e => `${e.from}→${e.to}`));

	let created = 0, skipped = 0;

	for (const edge of similarEdges) {
		const fromDate = dateMap.get(edge._from);
		const toDate = dateMap.get(edge._to);
		if (!fromDate || !toDate) { skipped++; continue; }

		const fromTime = Date.parse(fromDate);
		const toTime = Date.parse(toDate);
		if (isNaN(fromTime) || isNaN(toTime) || fromTime === toTime) { skipped++; continue; }

		// Determine temporal order: earlier → later
		const [earlier, later] = fromTime < toTime
			? [edge._from, edge._to]
			: [edge._to, edge._from];

		const key = `${earlier}→${later}`;
		if (existingSet.has(key)) { skipped++; continue; }

		console.log(`  PRECEDES: ${earlier} → ${later}  (${edge.temporal_relation}, from edge ${edge._id})`);

		if (!DRY_RUN) {
			await db.query(`
				INSERT {
					_from: @from,
					_to: @to,
					relation: "PRECEDES",
					type: "PRECEDES",
					derived_from: @derived_from,
					reason: @reason
				} INTO edges
			`, {
				from: earlier,
				to: later,
				derived_from: edge._id,
				reason: edge.temporal_relation,
			});
			existingSet.add(key);
		}
		created++;
	}

	console.log(`\n${DRY_RUN ? 'Would create' : 'Created'} ${created} PRECEDES edge(s). Skipped ${skipped} (missing dates or duplicate).`);
	if (DRY_RUN && created > 0) console.log('Re-run with --write to apply.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
