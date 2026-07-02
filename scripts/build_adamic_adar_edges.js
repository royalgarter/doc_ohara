#!/usr/bin/env node
/**
 * E5: ADAMIC_ADAR edges - structural co-citation weight between entities.
 *
 * For all entity pairs sharing ≥2 common RELATED_TO neighbors:
 *   AA(u,v) = Σ_{w ∈ N(u)∩N(v)} 1 / log(|N(w)|)
 *
 * Insert ADAMIC_ADAR edges (bidirectional) where AA score > threshold.
 * No LLM calls - pure graph math.
 *
 * Usage:
 *   node scripts/build_adamic_adar_edges.js --dry-run
 *   node scripts/build_adamic_adar_edges.js
 *   node scripts/build_adamic_adar_edges.js --threshold=0.5
 */

import { initArangoClient, insertEdge } from '../src/db/client.js';

const DRY_RUN = process.argv.includes('--dry-run');
const THRESHOLD = parseFloat((process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1]) || '0.3');
const MIN_COMMON = 2;

async function main() {
	const db = await initArangoClient();

	console.log('Loading entity neighbor sets from RELATED_TO edges…');

	// Build adjacency: entity._id → Set of neighbor entity._ids
	const cursor = await db.query(`
		FOR e IN edges
			FILTER e.relation == "RELATED_TO"
			RETURN { from: e._from, to: e._to }
	`);
	const relEdges = await cursor.all();

	const neighbors = new Map(); // entityId → Set<neighborId>
	for (const { from, to } of relEdges) {
		if (!neighbors.has(from)) neighbors.set(from, new Set());
		if (!neighbors.has(to)) neighbors.set(to, new Set());
		neighbors.get(from).add(to);
		neighbors.get(to).add(from);
	}

	const entityIds = [...neighbors.keys()];
	console.log(`${entityIds.length} entities with RELATED_TO neighbors`);

	// Compute AA scores for all pairs sharing ≥ MIN_COMMON neighbors
	let edgeCount = 0;
	let skipped = 0;
	const processed = new Set(); // "a::b" to avoid duplicate pairs

	for (let i = 0; i < entityIds.length; i++) {
		const u = entityIds[i];
		const Nu = neighbors.get(u);

		for (let j = i + 1; j < entityIds.length; j++) {
			const v = entityIds[j];
			const Nv = neighbors.get(v);

			// Intersection of neighbors
			const common = [...Nu].filter(w => Nv.has(w));
			if (common.length < MIN_COMMON) continue;

			// AA score
			let aa = 0;
			for (const w of common) {
				const deg = neighbors.get(w)?.size || 1;
				aa += 1 / Math.log(Math.max(deg, 2)); // log(1)=0 guard
			}

			if (aa < THRESHOLD) continue;

			const pairKey = [u, v].sort().join('::');
			if (processed.has(pairKey)) continue;
			processed.add(pairKey);

			if (DRY_RUN) {
				edgeCount++;
				if (edgeCount <= 5) console.log(`  AA(${u.split('/')[1]}, ${v.split('/')[1]}) = ${aa.toFixed(3)} via ${common.length} common neighbors`);
				continue;
			}

			// Skip if edge already exists
			const existing = await db.query(
				`FOR e IN edges FILTER e._from == @u AND e._to == @v AND e.relation == "ADAMIC_ADAR" LIMIT 1 RETURN 1`,
				{ u, v }
			).then(c => c.all()).catch(() => []);
			if (existing.length > 0) { skipped++; continue; }

			const score = Math.round(aa * 10000) / 10000;
			await insertEdge({ _from: u, _to: v, relation: 'ADAMIC_ADAR', type: 'ADAMIC_ADAR', weight: score, common_neighbor_count: common.length }).catch(() => {});
			await insertEdge({ _from: v, _to: u, relation: 'ADAMIC_ADAR', type: 'ADAMIC_ADAR', weight: score, common_neighbor_count: common.length }).catch(() => {});
			edgeCount += 2;
		}

		if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${entityIds.length} entities scanned, ${edgeCount} edges so far`);
	}

	if (DRY_RUN) {
		console.log(`[DRY RUN] Would create ~${edgeCount * 2} ADAMIC_ADAR edges (threshold=${THRESHOLD})`);
	} else {
		console.log(`Done. Created ${edgeCount} ADAMIC_ADAR edges, skipped ${skipped} existing. Threshold=${THRESHOLD}`);
	}
}

main().catch(err => { console.error(err.message); process.exit(1); });
