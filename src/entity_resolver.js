import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { cacheKeyFor, readCacheSync, writeCache, credFingerprint } from './cache.js';
import { VALID_ENTITY_TYPES } from './entities.js';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const BATCH_SIZE = 60;

function log(msg) {
	console.log(`[EntityResolver] ${msg}`);
}

// Load all entities from the collections paragraphs.json (and optionally documents.json).
// Returns Map<entityType, [{slug, canonical, aliases, sources:[docId]}]>
function loadEntitiesFromCollections(collectionsDir) {
	const paragraphsPath = path.join(collectionsDir, 'paragraphs.json');
	if (!fs.existsSync(paragraphsPath)) {
		throw new Error(`paragraphs.json not found in ${collectionsDir}`);
	}
	const paragraphs = JSON.parse(fs.readFileSync(paragraphsPath, 'utf-8'));

	const byType = new Map();
	for (const type of VALID_ENTITY_TYPES) byType.set(type, new Map()); // slug → entity entry

	for (const para of paragraphs) {
		const entities = para.entities || [];
		for (const e of entities) {
			if (!e.slug || !e.type || !VALID_ENTITY_TYPES.has(e.type)) continue;
			const typeMap = byType.get(e.type);
			if (typeMap.has(e.slug)) {
				const existing = typeMap.get(e.slug);
				const aliasSet = new Set(existing.aliases);
				for (const a of (e.aliases || [])) aliasSet.add(a);
				existing.aliases = [...aliasSet];
				if (!existing.sources.includes(para.document_id)) existing.sources.push(para.document_id);
			} else {
				typeMap.set(e.slug, {
					slug: e.slug,
					canonical: e.canonical,
					aliases: [...(e.aliases || [])],
					sources: [para.document_id].filter(Boolean),
				});
			}
		}
	}
	return byType;
}

// Format a batch of entities for the prompt
function formatEntityList(entities) {
	return entities.map(e => {
		const aliasStr = e.aliases.length > 0 ? ` | aliases: ${e.aliases.join(', ')}` : '';
		const srcStr = e.sources.length > 0 ? ` | docs: ${e.sources.slice(0, 3).join(', ')}` : '';
		return `- ${e.slug} | "${e.canonical}"${aliasStr}${srcStr}`;
	}).join('\n');
}

// Call LLM to resolve one batch of same-type entities.
// Returns { groups: [[slug,...]], variants: [{child, parent}] }
async function resolveBatch(ai, entityType, entities, promptTemplate) {
	const entityList = formatEntityList(entities);
	const prompt = promptTemplate
		.replace('{ENTITY_TYPE}', entityType)
		.replace('{ENTITY_LIST}', entityList);

	const credFp = credFingerprint();
	const key = cacheKeyFor(['resolve_entities_v1', entityType, entityList, GEMINI_MODEL, credFp]);
	const cached = readCacheSync(key);
	if (cached && cached.groups) return cached;

	const resp = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt, config: { serviceTier: 'flex' } });
	const raw = (resp.text || '').trim().replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim();

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		log(`Failed to parse LLM response for type ${entityType}: ${raw.slice(0, 200)}`);
		return { groups: [], variants: [] };
	}

	const result = {
		groups: Array.isArray(parsed.groups) ? parsed.groups.filter(g => Array.isArray(g) && g.length > 1) : [],
		variants: Array.isArray(parsed.variants) ? parsed.variants.filter(v => v.child && v.parent) : [],
	};
	writeCache(key, result);
	return result;
}

/**
 * Run entity resolution across all documents in the collections directory.
 * Reads paragraphs.json, groups entities by type, sends batches to LLM,
 * and writes a resolution manifest to collections/entity_resolution.json.
 *
 * @param {string} apiKey - Gemini API key
 * @param {string} collectionsDir - path to doc_pipeline/collections/
 * @returns {object} resolution manifest { merges, variants, stats }
 */
export async function runEntityResolution(apiKey, collectionsDir = 'doc_pipeline/collections') {
	if (!apiKey) throw new Error('GEMINI_API_KEY required for entity resolution');

	const ai = new GoogleGenAI({
		apiKey,
		httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
	});

	const promptTemplate = fs.readFileSync(path.join('prompts', 'resolve_entities.md'), 'utf-8').trim();
	const byType = loadEntitiesFromCollections(collectionsDir);

	const allMerges = []; // [{winner: slug, merged: [slug,...], type}]
	const allVariants = []; // [{child, parent, type}]
	let totalBatches = 0;
	let totalEntities = 0;

	for (const [entityType, typeMap] of byType) {
		const entities = [...typeMap.values()];
		if (entities.length < 2) continue;

		log(`Resolving ${entities.length} ${entityType} entities in batches of ${BATCH_SIZE}...`);
		totalEntities += entities.length;

		for (let i = 0; i < entities.length; i += BATCH_SIZE) {
			const batch = entities.slice(i, i + BATCH_SIZE);
			totalBatches++;
			try {
				const result = await resolveBatch(ai, entityType, batch, promptTemplate);

				for (const group of result.groups) {
					if (group.length < 2) continue;
					const winner = group[0];
					const merged = group.slice(1);
					allMerges.push({ winner, merged, type: entityType });
					log(`  Merge: ${merged.join(', ')} → ${winner} (${entityType})`);
				}
				for (const v of result.variants) {
					allVariants.push({ ...v, type: entityType });
					log(`  Variant: ${v.child} EXTENDS ${v.parent} (${entityType})`);
				}
			} catch (err) {
				log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} for ${entityType} failed: ${err.message}`);
			}
		}
	}

	const manifest = {
		generated_at: new Date().toISOString(),
		model: GEMINI_MODEL,
		stats: { total_entities: totalEntities, batches: totalBatches, merges: allMerges.length, variants: allVariants.length },
		merges: allMerges,
		variants: allVariants,
	};

	const outPath = path.join(collectionsDir, 'entity_resolution.json');
	fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
	log(`Resolution complete. ${allMerges.length} merge group(s), ${allVariants.length} variant(s). Written to ${outPath}`);
	return manifest;
}
