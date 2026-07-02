#!/usr/bin/env node
/**
 * E8: COMMUNITY_MEMBER edges - Louvain community detection on entity graph.
 *
 * Uses ArangoDB Pregel to run Louvain on the entities + RELATED_TO subgraph.
 * Each detected community gets a Gemini summary. Stores community docs in the
 * `communities` collection and creates COMMUNITY_MEMBER edges (entity → community).
 * Also flags RELATED_TO edges that cross community boundaries with is_surprising=true.
 *
 * Usage:
 *   node scripts/build_communities.js --dry-run     # report entity + edge counts
 *   node scripts/build_communities.js               # apply
 *   node scripts/build_communities.js --rebuild     # delete old communities first
 *   node scripts/build_communities.js --min-size=3  # skip tiny communities
 *
 * Requires ArangoDB Enterprise or ArangoDB >= 3.10 with Pregel enabled.
 * Falls back to JS label propagation if Pregel is unavailable.
 */

import { initArangoClient, insertEdge } from '../src/db/client.js';
import { cacheKeyFor, readCacheSync, writeCacheSync } from '../src/cache.js';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const REBUILD = process.argv.includes('--rebuild');
const MIN_SIZE = parseInt((process.argv.find(a => a.startsWith('--min-size='))?.split('=')[1]) || '2', 10);
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const PREGEL_TIMEOUT_MS = 120_000; // 2 min

// ── JS fallback: label propagation ───────────────────────────────────────────
// Used when Pregel is unavailable. Deterministic via sorted node IDs.

function labelPropagation(entityIds, adjMap, maxIter = 30) {
	const labels = new Map(entityIds.map(id => [id, id])); // init each node = own community

	for (let i = 0; i < maxIter; i++) {
		let changed = false;
		for (const id of entityIds) {
			const neighbors = adjMap.get(id) || [];
			if (!neighbors.length) continue;
			// Pick most frequent label among neighbors; tie-break by min string
			const freq = new Map();
			for (const nb of neighbors) {
				const l = labels.get(nb) || nb;
				freq.set(l, (freq.get(l) || 0) + 1);
			}
			let best = labels.get(id);
			let bestCount = 0;
			for (const [l, c] of freq) {
				if (c > bestCount || (c === bestCount && l < best)) { best = l; bestCount = c; }
			}
			if (best !== labels.get(id)) { labels.set(id, best); changed = true; }
		}
		if (!changed) break;
	}
	return labels; // Map<entityId, communityLabel>
}

// ── Pregel Louvain ────────────────────────────────────────────────────────────

async function runPregelLouvain(db) {
	const jobId = await db.query(`RETURN PREGEL_START("louvain", "entities", "edges", { resultField: "community", store: true, maxIterations: 100, edgeCollectionRestrictions: { edges: ["RELATED_TO"] } })`).then(c => c.next());
	if (!jobId) throw new Error('PREGEL_START returned null');

	const deadline = Date.now() + PREGEL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise(r => setTimeout(r, 2000));
		const status = await db.query(`RETURN PREGEL_STATUS(@id)`, { id: jobId }).then(c => c.next());
		if (status?.state === 'done') return true;
		if (status?.state === 'canceled' || status?.state === 'fatal error') throw new Error(`Pregel failed: ${status.state}`);
	}
	throw new Error('Pregel timeout');
}

// ── Gemini summary ────────────────────────────────────────────────────────────

async function summariseCommunity(ai, memberNames, snippets) {
	const key = cacheKeyFor(['community_summary_v1', GEMINI_MODEL, memberNames.slice(0, 20).join(','), snippets.slice(0, 2000)]);
	const cached = readCacheSync(key);
	if (cached?.summary) return cached.summary;

	const prompt = `These entities form a topological community in a knowledge graph based on co-occurrence patterns.\nEntities: ${memberNames.slice(0, 20).join(', ')}\n\nRepresentative passages:\n${snippets.slice(0, 3000)}\n\nDescribe the emergent topic this community represents in 1-2 sentences. Be specific about the domain/concept cluster - do not just list entity names.`;
	try {
		const resp = await ai.models.generateContent({
			model: GEMINI_MODEL,
			contents: prompt,
			config: { serviceTier: 'flex', temperature: 0 },
		});
		const summary = (resp.text || '').trim().slice(0, 400);
		writeCacheSync(key, { summary });
		return summary;
	} catch (_) {
		return `Community of: ${memberNames.slice(0, 5).join(', ')}`;
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
	const db = await initArangoClient();
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	if (REBUILD && !DRY_RUN) {
		console.log('Deleting existing communities and COMMUNITY_MEMBER edges…');
		await db.query(`FOR c IN communities REMOVE c IN communities`).catch(() => {});
		await db.query(`FOR e IN edges FILTER e.relation == "COMMUNITY_MEMBER" REMOVE e IN edges`).catch(() => {});
	}

	// Load all entities
	console.log('Loading entity graph…');
	const entCursor = await db.query(`FOR e IN entities RETURN { _id: e._id, _key: e._key, name: e.name, slug: e.slug, community: e.community }`);
	const entityList = await entCursor.all();
	if (!entityList.length) { console.log('No entities found.'); return; }

	// Load RELATED_TO edges
	const edgeCursor = await db.query(`FOR e IN edges FILTER e.relation == "RELATED_TO" RETURN { from: e._from, to: e._to, _id: e._id, _key: e._key }`);
	const relEdges = await edgeCursor.all();

	console.log(`${entityList.length} entities, ${relEdges.length} RELATED_TO edges`);

	if (DRY_RUN) {
		console.log(`[DRY RUN] Would run Louvain on ${entityList.length} entities`);
		return;
	}

	// Build adjacency map for fallback
	const adjMap = new Map(entityList.map(e => [e._id, []]));
	for (const { from, to } of relEdges) {
		adjMap.get(from)?.push(to);
		adjMap.get(to)?.push(from);
	}

	// Try Pregel first; fall back to JS label propagation
	let communityMap; // Map<entityId, communityLabel>
	let usedPreg = false;
	try {
		console.log('Attempting Pregel Louvain…');
		await runPregelLouvain(db);
		// Pregel writes community field directly onto entity nodes
		const updated = await db.query(`FOR e IN entities RETURN { _id: e._id, community: e.community }`).then(c => c.all());
		communityMap = new Map(updated.map(e => [e._id, String(e.community ?? e._id)]));
		usedPreg = true;
		console.log('Pregel done.');
	} catch (err) {
		console.warn(`Pregel unavailable (${err.message}) - using JS label propagation fallback`);
		communityMap = labelPropagation(entityList.map(e => e._id), adjMap);
	}

	// Group entities by community label
	const communityGroups = new Map(); // label → [entity]
	for (const entity of entityList) {
		const label = communityMap.get(entity._id) || entity._id;
		if (!communityGroups.has(label)) communityGroups.set(label, []);
		communityGroups.get(label).push(entity);
	}

	console.log(`${communityGroups.size} communities detected (method: ${usedPreg ? 'pregel_louvain' : 'label_propagation'})`);

	const commColl = db.collection('communities');
	const edgesColl = db.collection('edges');

	// community label → community _id (for cross-community edge flagging)
	const labelToCommId = new Map();
	// entity _id → community _id
	const entityToCommId = new Map();

	let commCount = 0;
	let edgeCount = 0;

	for (const [label, members] of communityGroups) {
		if (members.length < MIN_SIZE) continue;

		const memberNames = members.map(e => e.name || e.slug || e._key).filter(Boolean);
		const memberSlugs = members.map(e => e.slug).filter(Boolean);

		// Fetch representative snippets for summary
		const snippets = memberSlugs.length
			? await db.query(
				`FOR p IN paragraphs FILTER LENGTH(INTERSECTION(p.entity_slugs, @slugs)) > 0 LIMIT 5 RETURN p.content`,
				{ slugs: memberSlugs.slice(0, 10) }
			).then(c => c.all()).catch(() => [])
			: [];

		const summary = await summariseCommunity(ai, memberNames, snippets.map(s => (s || '').slice(0, 300)).join('\n\n'));

		const commDoc = await commColl.save({
			summary,
			label: String(label),
			member_count: members.length,
			member_entity_slugs: memberSlugs.slice(0, 30),
			detection_method: usedPreg ? 'pregel_louvain' : 'label_propagation',
			built_at: new Date().toISOString(),
		}, { returnNew: true });

		const commId = commDoc.new._id;
		labelToCommId.set(label, commId);
		commCount++;

		for (const entity of members) {
			entityToCommId.set(entity._id, commId);
			await edgesColl.save({
				_from: entity._id,
				_to: commId,
				relation: 'COMMUNITY_MEMBER',
				type: 'COMMUNITY_MEMBER',
				community_label: String(label),
			}).catch(() => {});
			edgeCount++;
		}

		console.log(`Community [${String(label).slice(0, 8)}]: ${members.length} entities - "${summary.slice(0, 70)}…"`);
	}

	// Flag RELATED_TO edges that cross community boundaries as is_surprising=true
	console.log('Flagging cross-community RELATED_TO edges…');
	let surprisingCount = 0;
	for (const edge of relEdges) {
		const commA = entityToCommId.get(edge.from);
		const commB = entityToCommId.get(edge.to);
		if (commA && commB && commA !== commB) {
			await db.query(`UPDATE @key WITH { is_surprising: true } IN edges`, { key: edge._key }).catch(() => {});
			surprisingCount++;
		}
	}

	console.log(`Done. ${commCount} communities, ${edgeCount} COMMUNITY_MEMBER edges, ${surprisingCount} surprising cross-community links.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
