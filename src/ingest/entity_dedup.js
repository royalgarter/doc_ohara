#!/usr/bin/env node
/**
 * Cross-document entity deduplication worker.
 *
 * Finds entity nodes in ArangoDB that share the same norm_key (normalized canonical name)
 * and merges them: unions aliases + document_ids, sums mention_counts, repoints all
 * MENTIONS edges from the duplicate to the surviving canonical entity node.
 *
 * Run after batch ingest: node src/ingest/entity_dedup.js
 */

import { initArangoClient } from '../db/client.js';

async function run() {
	const db = await initArangoClient();

	// Find groups of entities that share a norm_key
	const cursor = await db.query(`
		FOR e IN entities
			COLLECT norm = e.norm_key INTO group
			FILTER LENGTH(group) > 1
			RETURN { norm, entities: group[*].e }
	`);
	const groups = await cursor.all();

	if (groups.length === 0) {
		console.log('No duplicate entities found.');
		return;
	}

	console.log(`Found ${groups.length} duplicate group(s). Merging...`);

	for (const { norm, entities } of groups) {
		// Survive the entity with the highest mention_count; on tie, the oldest (first_seen)
		const sorted = [...entities].sort((a, b) =>
			b.mention_count - a.mention_count || new Date(a.first_seen) - new Date(b.first_seen)
		);
		const canonical = sorted[0];
		const duplicates = sorted.slice(1);

		// Merge aliases and document_ids into the canonical
		const aliasSet = new Set(canonical.aliases || []);
		const docIdSet = new Set(canonical.document_ids || []);
		let totalMentions = canonical.mention_count || 0;

		for (const dup of duplicates) {
			for (const a of (dup.aliases || [])) aliasSet.add(a);
			aliasSet.add(dup.name);
			for (const d of (dup.document_ids || [])) docIdSet.add(d);
			totalMentions += dup.mention_count || 0;
		}
		aliasSet.delete(canonical.name);

		await db.query({
			query: `UPDATE @key WITH { aliases: @aliases, document_ids: @docIds, mention_count: @count } IN entities`,
			bindVars: {
				key: canonical._key,
				aliases: [...aliasSet],
				docIds: [...docIdSet],
				count: totalMentions,
			},
		});

		// Repoint MENTIONS and RELATED_TO edges from each duplicate to the canonical
		for (const dup of duplicates) {
			const dupId = dup._id;
			const canonId = canonical._id;

			// Repoint _to edges (MENTIONS: paragraph → entity)
			await db.query({
				query: `
					FOR e IN edges FILTER e._to == @dupId
						UPDATE e WITH { _to: @canonId } IN edges
				`,
				bindVars: { dupId, canonId },
			});

			// Repoint _from edges (RELATED_TO: entity → entity)
			await db.query({
				query: `
					FOR e IN edges FILTER e._from == @dupId
						UPDATE e WITH { _from: @canonId } IN edges
				`,
				bindVars: { dupId, canonId },
			});

			// Remove duplicate entity node
			await db.query({
				query: `REMOVE @key IN entities`,
				bindVars: { key: dup._key },
			});

			console.log(`  Merged "${dup.name}" (${dup._key}) → "${canonical.name}" (${canonical._key})`);
		}
	}

	console.log('Deduplication complete.');
}

run().catch(err => { console.error(err.message); process.exit(1); });
