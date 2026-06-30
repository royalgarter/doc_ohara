#!/usr/bin/env node
/**
 * E7: CLUSTER_MEMBER edges — RAPTOR-inspired semantic cluster retrieval.
 *
 * Fetches all paragraphs with embeddings, runs k-means clustering,
 * generates a Gemini summary per cluster, stores cluster nodes in `clusters`
 * collection, and creates CLUSTER_MEMBER edges (paragraph → cluster).
 *
 * Requires paragraphs to have `.embedding` field (OHARA_EMBED_PARAGRAPHS=true).
 *
 * Usage:
 *   node scripts/build_clusters.js --dry-run        # preview cluster sizes
 *   node scripts/build_clusters.js                  # apply (k=auto)
 *   node scripts/build_clusters.js --k=20           # explicit cluster count
 *   node scripts/build_clusters.js --min-size=3     # skip clusters with < N members
 *   node scripts/build_clusters.js --rebuild        # delete existing clusters first
 */

import { initArangoClient, insertEdge } from '../src/db/client.js';
import { cacheKeyFor, readCacheSync, writeCacheSync } from '../src/cache.js';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const REBUILD = process.argv.includes('--rebuild');
const K_OVERRIDE = parseInt((process.argv.find(a => a.startsWith('--k='))?.split('=')[1]) || '0', 10) || null;
const MIN_SIZE = parseInt((process.argv.find(a => a.startsWith('--min-size='))?.split('=')[1]) || '3', 10);
const MAX_ITER = 50;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// ── K-Means ──────────────────────────────────────────────────────────────────

function dot(a, b) {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function norm(a) {
	return Math.sqrt(dot(a, a));
}

function cosineSim(a, b) {
	const n = norm(a) * norm(b);
	return n === 0 ? 0 : dot(a, b) / n;
}

function meanVec(vecs) {
	const dim = vecs[0].length;
	const out = new Array(dim).fill(0);
	for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i];
	const n = vecs.length;
	return out.map(x => x / n);
}

function kmeans(vectors, k, maxIter = MAX_ITER) {
	// K-means++ initialisation
	const centroids = [vectors[Math.floor(Math.random() * vectors.length)]];
	while (centroids.length < k) {
		const dists = vectors.map(v => {
			const best = Math.max(...centroids.map(c => cosineSim(v, c)));
			return Math.max(0, 1 - best);
		});
		const total = dists.reduce((s, d) => s + d, 0);
		let r = Math.random() * total;
		let idx = 0;
		for (let i = 0; i < dists.length; i++) {
			r -= dists[i];
			if (r <= 0) { idx = i; break; }
		}
		centroids.push(vectors[idx]);
	}

	let assignments = new Array(vectors.length).fill(0);

	for (let iter = 0; iter < maxIter; iter++) {
		// Assign
		let changed = false;
		for (let i = 0; i < vectors.length; i++) {
			let best = -Infinity;
			let bestC = 0;
			for (let c = 0; c < k; c++) {
				const s = cosineSim(vectors[i], centroids[c]);
				if (s > best) { best = s; bestC = c; }
			}
			if (assignments[i] !== bestC) { assignments[i] = bestC; changed = true; }
		}
		if (!changed) break;

		// Update centroids
		for (let c = 0; c < k; c++) {
			const members = vectors.filter((_, i) => assignments[i] === c);
			if (members.length > 0) centroids[c] = meanVec(members);
		}
	}

	return assignments;
}

// ── Gemini summary ────────────────────────────────────────────────────────────

async function summariseCluster(ai, members) {
	const snippets = members
		.slice(0, 8)
		.map(m => m.content?.slice(0, 300) || '')
		.filter(Boolean)
		.join('\n\n---\n\n');
	const entityNames = [...new Set(members.flatMap(m => m.entity_slugs || []))].slice(0, 15).join(', ');

	const key = cacheKeyFor(['cluster_summary_v1', GEMINI_MODEL, snippets.slice(0, 3000)]);
	const cached = readCacheSync(key);
	if (cached?.summary) return cached;

	const prompt = `Summarise the common theme across these ${members.length} document passages in 1-2 sentences. Be specific — name the topic/concept/domain they share.\n\nKey entities: ${entityNames || '(none)'}\n\nPASSAGES:\n${snippets.slice(0, 4000)}`;
	try {
		const resp = await ai.models.generateContent({
			model: GEMINI_MODEL,
			contents: prompt,
			config: { serviceTier: 'flex', temperature: 0 },
		});
		const summary = (resp.text || '').trim().slice(0, 500);
		const result = { summary, member_count: members.length, centroid_entity_slugs: (entityNames || '').split(', ').filter(Boolean).slice(0, 10) };
		writeCacheSync(key, result);
		return result;
	} catch (_) {
		return { summary: '(no summary)', member_count: members.length, centroid_entity_slugs: [] };
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
	const db = await initArangoClient();
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	if (REBUILD && !DRY_RUN) {
		console.log('Deleting existing clusters and CLUSTER_MEMBER edges…');
		await db.query(`FOR c IN clusters REMOVE c IN clusters`).catch(() => {});
		await db.query(`FOR e IN edges FILTER e.relation == "CLUSTER_MEMBER" REMOVE e IN edges`).catch(() => {});
	}

	console.log('Loading paragraphs with embeddings…');
	const cursor = await db.query(`
		FOR p IN paragraphs
			FILTER IS_ARRAY(p.embedding) AND LENGTH(p.embedding) > 0
			RETURN { _id: p._id, _key: p._key, content: p.content, entity_slugs: p.entity_slugs, document_id: p.document_id, section_id: p.section_id }
	`);
	const paragraphs = await cursor.all();

	if (paragraphs.length < 4) {
		console.log(`Only ${paragraphs.length} paragraphs have embeddings. Ingest with OHARA_EMBED_PARAGRAPHS=true first.`);
		process.exit(0);
	}

	// Load embeddings separately (large — avoid loading all at once in same query)
	console.log(`Loading ${paragraphs.length} embeddings…`);
	const embCursor = await db.query(`
		FOR p IN paragraphs
			FILTER IS_ARRAY(p.embedding) AND LENGTH(p.embedding) > 0
			RETURN { _id: p._id, embedding: p.embedding }
	`);
	const embRows = await embCursor.all();
	const embMap = new Map(embRows.map(r => [r._id, r.embedding]));

	const vectors = paragraphs.map(p => embMap.get(p._id)).filter(Boolean);
	const validParas = paragraphs.filter(p => embMap.has(p._id));

	// Auto k: sqrt(n/2) capped at 50
	const k = K_OVERRIDE || Math.min(50, Math.max(3, Math.round(Math.sqrt(validParas.length / 2))));
	console.log(`Running k-means: ${validParas.length} paragraphs → k=${k} clusters`);

	if (DRY_RUN) {
		console.log(`[DRY RUN] Would create ~${k} clusters, ~${validParas.length} CLUSTER_MEMBER edges`);
		return;
	}

	const assignments = kmeans(vectors, k);

	// Group paragraphs by cluster
	const clusterMap = new Map(); // clusterIdx → [para]
	for (let i = 0; i < validParas.length; i++) {
		const c = assignments[i];
		if (!clusterMap.has(c)) clusterMap.set(c, []);
		clusterMap.get(c).push(validParas[i]);
	}

	const clustersColl = db.collection('clusters');
	const edgesColl = db.collection('edges');

	let clusterCount = 0;
	let edgeCount = 0;

	for (const [idx, members] of clusterMap) {
		if (members.length < MIN_SIZE) continue;

		const { summary, centroid_entity_slugs } = await summariseCluster(ai, members);
		console.log(`Cluster ${idx}: ${members.length} members — "${summary.slice(0, 80)}…"`);

		const clusterDoc = await clustersColl.save({
			summary,
			member_count: members.length,
			centroid_entity_slugs,
			cluster_index: idx,
			built_at: new Date().toISOString(),
		}, { returnNew: true });

		const clusterId = clusterDoc.new._id;
		clusterCount++;

		for (const p of members) {
			await edgesColl.save({
				_from: p._id,
				_to: clusterId,
				relation: 'CLUSTER_MEMBER',
				type: 'CLUSTER_MEMBER',
				cluster_index: idx,
			}).catch(() => {});
			edgeCount++;
		}
	}

	console.log(`Done. Created ${clusterCount} clusters, ${edgeCount} CLUSTER_MEMBER edges.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
