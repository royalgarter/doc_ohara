import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as arangoClient from './db/client.js';

const DEFAULT_DIR = '.ohara_llm_cache';

function ensureDir(dir) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getCacheDir() {
	return process.env.OHARA_LLM_CACHE_DIR || path.join(process.cwd(), DEFAULT_DIR);
}

export function cacheKeyFor(parts) {
	const hash = crypto.createHash('sha256');
	for (const p of parts) hash.update(String(p));
	return hash.digest('hex');
}

export function getCachePath(key) {
	const dir = getCacheDir();
	ensureDir(dir);
	return path.join(dir, `${key}.json`);
}

export function hasCache(key) {
	return fs.existsSync(getCachePath(key));
}

export function readCacheSync(key) {
	const p = getCachePath(key);
	if (!fs.existsSync(p)) return null;
	try {
		const raw = fs.readFileSync(p, 'utf-8');
		return JSON.parse(raw);
	} catch (err) {
		return null;
	}
}

export async function readCacheAsync(key) {
	// check disk first
	const disk = readCacheSync(key);
	if (disk) {
		// ensure DB copy exists for disk cache
		if (process.env.ARANGO_URL) {
			try {
				await arangoClient.initArangoClient();
				const db = (await arangoClient.initArangoClient());
				const coll = db.collection('llm_cache');
				// upsert disk cache into DB for future reads
				const doc = { _key: key, ...disk };
				await coll.replace(key, doc).catch(async (err) => {
					await coll.save(doc).catch(() => {});
				});
			} catch (err) {
				// ignore DB cache errors
			}
		}
		return disk;
	}

	// check DB if configured
	if (process.env.ARANGO_URL) {
		try {
			await arangoClient.initArangoClient();
			const db = (await arangoClient.initArangoClient());
			const coll = db.collection('llm_cache');
			const cursor = await db.query(
				`FOR c IN llm_cache
				FILTER c._key == @k
				LIMIT 1
				RETURN c`,
				{ k: key }
			);
			const rows = await cursor.all();
			if (rows && rows.length > 0) return rows[0];
		} catch (err) {
			// ignore DB cache errors and fall back to disk-only
			return null;
		}
	}
	return null;
}

export function writeCacheSync(key, value) {
	const dir = getCacheDir();
	ensureDir(dir);
	const p = getCachePath(key);
	const tmp = `${p}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
	fs.renameSync(tmp, p);
}

export async function writeCacheAsync(key, value) {
	// write to disk first
	writeCacheSync(key, value);

	// also persist to ArangoDB if available (non-blocking)
	if (process.env.ARANGO_URL) {
		try {
			await arangoClient.initArangoClient();
			const db = (await arangoClient.initArangoClient());
			const coll = db.collection('llm_cache');
			// include key in document
			const doc = { _key: key, ...value };
			// upsert behavior: replace
			await coll.replace(key, doc).catch(async (err) => {
				// if not found, save
				await coll.save(doc).catch(() => {});
			});
		} catch (err) {
			// ignore db cache errors
		}
	}
}

export function writeCache(key, value) {
	// synchronous wrapper used by pipeline; fire-and-forget async DB write
	writeCacheSync(key, value);
	writeCacheAsync(key, value).catch(() => {});
}

export function credFingerprint() {
	// derive a simple fingerprint from relevant env vars without printing secrets
	const keys = ['GEMINI_API_KEY', 'ARANGO_URL', 'OHARA_LLM_PROVIDER'];
	const vals = keys.map(k => process.env[k] ? crypto.createHash('sha256').update(process.env[k]).digest('hex').slice(0,8) : '');
	return crypto.createHash('sha256').update(vals.join(':')).digest('hex');
}
