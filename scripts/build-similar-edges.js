/**
 * Build SIMILAR_TO edges between documents using Jaccard similarity on entity_slugs.
 * Run after ingesting new documents:
 *   node --env-file=.env scripts/build-similar-edges.js          # dry-run
 *   node --env-file=.env scripts/build-similar-edges.js --write  # apply
 */
import { initArangoClient } from '../src/db/client.js';

const WRITE = process.argv.includes('--write');
const THRESHOLD = parseFloat(process.env.OHARA_SIMILARITY_THRESHOLD || '0.1');

async function main() {
	const db = await initArangoClient();

	// Load all docs
	const docsCursor = await db.query(`
		FOR d IN documents
		RETURN { _key: d._key, _id: d._id, title: d.title }
	`);
	const docs = await docsCursor.all();
	console.log(`Loaded ${docs.length} documents`);

	// Build doc -> Set<entityKey> map from entities collection (canonical, aggregated)
	const docEntityMap = new Map(docs.map(d => [d._key, new Set()]));
	const entCursor = await db.query(`
		FOR e IN entities
		FILTER LENGTH(e.document_ids) > 0
		RETURN { key: e._key, doc_ids: e.document_ids }
	`);
	for await (const e of entCursor) {
		for (const dk of (e.doc_ids || [])) {
			if (docEntityMap.has(dk)) docEntityMap.get(dk).add(e.key);
		}
	}
	docs.forEach(d => console.log(`  ${d.title?.slice(0,40)} - entities: ${docEntityMap.get(d._key)?.size}`));

	// Load existing SIMILAR_TO edges to avoid duplicates
	const existingCursor = await db.query(`
		FOR e IN edges FILTER e.relation == 'SIMILAR_TO'
		RETURN { from: e._from, to: e._to }
	`);
	const existingEdges = new Set((await existingCursor.all()).map(e => `${e.from}|${e.to}`));
	console.log(`Existing SIMILAR_TO edges: ${existingEdges.size}`);

	let created = 0, skipped = 0, dryRun = 0;

	for (let i = 0; i < docs.length; i++) {
		const a = docs[i];
		const setA = docEntityMap.get(a._key);
		if (!setA?.size) continue;

		for (let j = i + 1; j < docs.length; j++) {
			const b = docs[j];
			const setB = docEntityMap.get(b._key);
			if (!setB?.size) continue;

			const shared = [...setA].filter(s => setB.has(s));
			// Dice coefficient: less penalized by size difference than Jaccard
			const dice = (setA.size + setB.size) > 0 ? (2 * shared.length) / (setA.size + setB.size) : 0;

			if (dice < THRESHOLD) continue;
			const jaccard = shared.length / new Set([...setA, ...setB]).size;

			const keyAB = `${a._id}|${b._id}`;
			const keyBA = `${b._id}|${a._id}`;
			if (existingEdges.has(keyAB) || existingEdges.has(keyBA)) {
				skipped++;
				continue;
			}

			if (WRITE) {
				await db.collection('edges').save({
					_from: a._id,
					_to: b._id,
					relation: 'SIMILAR_TO',
					type: 'SIMILAR_TO',
					weight: Math.round(dice * 1000) / 1000,
					jaccard: Math.round(jaccard * 1000) / 1000,
					shared_entities: shared.length,
					shared_entity_keys: shared.slice(0, 20),
				});
				existingEdges.add(keyAB);
				created++;
			} else {
				dryRun++;
			}
			console.log(`${WRITE ? 'Created' : 'Would create'} SIMILAR_TO: "${a.title?.slice(0,40)}" <-> "${b.title?.slice(0,40)}" dice=${dice.toFixed(3)} jaccard=${jaccard.toFixed(3)} shared=${shared.length}`);
		}
	}

	if (WRITE) {
		console.log(`\nDone: created ${created} SIMILAR_TO edges, skipped ${skipped} existing`);
	} else {
		console.log(`\nDry-run: would create ${dryRun} edges. Run with --write to apply.`);
	}
}

main().catch(err => { console.error(err); process.exit(1); });
