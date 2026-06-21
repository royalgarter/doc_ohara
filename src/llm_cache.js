import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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

export function readCache(key) {
  const p = getCachePath(key);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export function writeCache(key, value) {
  const dir = getCacheDir();
  ensureDir(dir);
  const p = getCachePath(key);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export function credFingerprint() {
  // derive a simple fingerprint from relevant env vars without printing secrets
  const keys = ['GEMINI_API_KEY', 'ARANGO_URL', 'OHARA_LLM_PROVIDER'];
  const vals = keys.map(k => process.env[k] ? crypto.createHash('sha256').update(process.env[k]).digest('hex').slice(0,8) : '');
  return crypto.createHash('sha256').update(vals.join(':')).digest('hex');
}
