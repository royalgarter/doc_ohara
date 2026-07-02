#!/usr/bin/env node
/**
 * E6: Knowledge Gap flagging - isolation signal.
 *
 * Flags isolated nodes:
 *   - Entities with RELATED_TO degree < 2 → entity.isolated = true
 *   - Documents with similar_to_indegree == 0 → document.isolated = true
 *
 * These drive Explorer tier "Knowledge Gap" cards and Speculative RAG pre-warm seeds.
 *
 * Usage:
 *   node scripts/find_knowledge_gaps.js --dry-run   # report only
 *   node scripts/find_knowledge_gaps.js             # apply flags
 *   node scripts/find_knowledge_gaps.js --clear     # remove all isolation flags
 */

import { initArangoClient } from '../src/db/client.js';

const DRY_RUN = process.argv.includes('--dry-run');
const CLEAR = process.argv.includes('--clear');
const ENTITY_DEGREE_THRESHOLD = parseInt((process.argv.find(a => a.startsWith('--entity-threshold='))?.split('=')[1]) || '2', 10);

async function main() {
	const db = await initArangoClient();

	if (CLEAR) {
		await db.query(`FOR e IN entities FILTER e.isolated == true UPDATE e WITH { isolated: false, isolation_reason: null } IN entities`);
		await db.query(`FOR d IN documents FILTER d.isolated == true UPDATE d WITH { isolated: false, isolation_reason: null } IN documents`);
		console.log('Cleared all isolation flags.');
		return;
	}

	// ── Entity isolation ──────────────────────────────────────────────────────
	console.log('Scanning entity RELATED_TO degrees…');
	const entityDegreeCursor = await db.query(`
		FOR e IN entities
			LET degree = LENGTH(
				FOR edge IN edges
					FILTER (edge._from == e._id OR edge._to == e._id) AND edge.relation == "RELATED_TO"
					LIMIT 1
					RETURN 1
			)
			RETURN { _id: e._id, _key: e._key, name: e.name, degree: LENGTH(
				FOR edge IN edges
					FILTER (edge._from == e._id OR edge._to == e._id) AND edge.relation == "RELATED_TO"
					RETURN 1
			)}
	`);
	const entities = await entityDegreeCursor.all();

	const isolatedEntities = entities.filter(e => e.degree < ENTITY_DEGREE_THRESHOLD);
	console.log(`Entities total: ${entities.length}, isolated (degree < ${ENTITY_DEGREE_THRESHOLD}): ${isolatedEntities.length}`);

	if (!DRY_RUN) {
		for (const e of isolatedEntities) {
			await db.query(
				`UPDATE @key WITH { isolated: true, isolation_reason: @reason } IN entities`,
				{ key: e._key, reason: `RELATED_TO degree ${e.degree} < ${ENTITY_DEGREE_THRESHOLD}` }
			).catch(() => {});
		}
		// Clear isolation flag on now-connected entities
		const connectedEntities = entities.filter(e => e.degree >= ENTITY_DEGREE_THRESHOLD);
		for (const e of connectedEntities) {
			await db.query(
				`UPDATE @key WITH { isolated: false } IN entities`,
				{ key: e._key }
			).catch(() => {});
		}
		console.log(`Flagged ${isolatedEntities.length} isolated entities.`);
	} else {
		console.log('[DRY RUN] Top 10 isolated entities:');
		isolatedEntities.slice(0, 10).forEach(e => console.log(`  ${e.name} (degree=${e.degree})`));
	}

	// ── Document isolation ────────────────────────────────────────────────────
	console.log('Scanning document SIMILAR_TO indegree…');
	const docCursor = await db.query(`
		FOR d IN documents
			RETURN { _id: d._id, _key: d._key, title: d.title, similar_to_indegree: d.similar_to_indegree || 0 }
	`);
	const documents = await docCursor.all();

	const isolatedDocs = documents.filter(d => (d.similar_to_indegree || 0) === 0);
	console.log(`Documents total: ${documents.length}, isolated (similar_to_indegree=0): ${isolatedDocs.length}`);

	if (!DRY_RUN) {
		for (const d of isolatedDocs) {
			await db.query(
				`UPDATE @key WITH { isolated: true, isolation_reason: @reason } IN documents`,
				{ key: d._key, reason: 'similar_to_indegree=0: no cross-doc similarity edges' }
			).catch(() => {});
		}
		const connectedDocs = documents.filter(d => (d.similar_to_indegree || 0) > 0);
		for (const d of connectedDocs) {
			await db.query(`UPDATE @key WITH { isolated: false } IN documents`, { key: d._key }).catch(() => {});
		}
		console.log(`Flagged ${isolatedDocs.length} isolated documents.`);
	} else {
		console.log('[DRY RUN] Isolated documents:');
		isolatedDocs.slice(0, 10).forEach(d => console.log(`  "${d.title}" (indegree=${d.similar_to_indegree})`));
	}

	// ── Summary ───────────────────────────────────────────────────────────────
	console.log('\n── Knowledge Gap Summary ──');
	console.log(`Isolated entities : ${isolatedEntities.length} / ${entities.length}`);
	console.log(`Isolated documents: ${isolatedDocs.length} / ${documents.length}`);
	if (DRY_RUN) console.log('Run without --dry-run to apply flags.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
