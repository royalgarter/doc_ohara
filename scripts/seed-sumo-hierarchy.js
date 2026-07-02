/**
 * Seed SUMO ontology hierarchy into ArangoDB.
 *
 * Creates:
 *   sumo_concepts  - vertex per SUMO class (4500+ nodes)
 *   edges          - SUB_CLASS_OF edges (child → parent)
 *
 * Safe to re-run: upserts everything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { initArangoClient } from '../src/db/client.js';

const HIERARCHY_PATH = path.join(process.cwd(), 'ontology', 'sumo_hierarchy.json');
const CATEGORIES_PATH = path.join(process.cwd(), 'ontology', 'sumo_tag_categories.json');

const BATCH = 500;

async function run() {
	const db = await initArangoClient();

	// Ensure sumo_concepts vertex collection exists
	const conceptsColl = db.collection('sumo_concepts');
	if (!(await conceptsColl.exists())) {
		await db.createCollection('sumo_concepts');
		console.log('Created sumo_concepts collection');
	}

	const edgesColl = db.collection('edges');

	const hierarchy = JSON.parse(fs.readFileSync(HIERARCHY_PATH, 'utf-8'));
	const categories = JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf-8'));
	const catMap = categories.map; // tag → depth-3 category name

	// Collect all node names (children + parents)
	const allNames = new Set(Object.keys(hierarchy));
	for (const parents of Object.values(hierarchy)) for (const p of parents) allNames.add(p);
	allNames.add('Entity'); // root

	console.log(`Upserting ${allNames.size} concept nodes...`);
	const names = [...allNames];
	for (let i = 0; i < names.length; i += BATCH) {
		const batch = names.slice(i, i + BATCH);
		await db.query({
			query: `
				FOR doc IN @batch
					UPSERT { _key: doc._key }
					INSERT doc
					UPDATE { category: doc.category }
					IN sumo_concepts
			`,
			bindVars: {
				batch: batch.map(n => ({
					_key: n,
					_id: `sumo_concepts/${n}`,
					name: n,
					category: catMap[n] || null,
				})),
			},
		});
		process.stdout.write(`\r  nodes: ${Math.min(i + BATCH, names.length)}/${names.size ?? names.length}`);
	}
	console.log('\nNodes done.');

	// Build SUB_CLASS_OF edges: child --SUB_CLASS_OF--> parent
	const edgeDocs = [];
	for (const [child, parents] of Object.entries(hierarchy)) {
		for (const parent of parents) {
			edgeDocs.push({
				_from: `sumo_concepts/${child}`,
				_to: `sumo_concepts/${parent}`,
				relation: 'SUB_CLASS_OF',
				type: 'SUB_CLASS_OF',
			});
		}
	}

	console.log(`Upserting ${edgeDocs.length} SUB_CLASS_OF edges...`);
	for (let i = 0; i < edgeDocs.length; i += BATCH) {
		const batch = edgeDocs.slice(i, i + BATCH);
		await db.query({
			query: `
				FOR e IN @batch
					UPSERT { _from: e._from, _to: e._to, relation: 'SUB_CLASS_OF' }
					INSERT e
					UPDATE {}
					IN edges
			`,
			bindVars: { batch },
		});
		process.stdout.write(`\r  edges: ${Math.min(i + BATCH, edgeDocs.length)}/${edgeDocs.length}`);
	}
	console.log('\nEdges done.');
	console.log('SUMO hierarchy seeded successfully.');
}

run().catch(err => { console.error(err); process.exit(1); });
