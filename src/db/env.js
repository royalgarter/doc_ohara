/**
 * ArangoDB-backed environment store.
 *
 * Only ARANGO_URL and GEMINI_API_KEY live in .env.
 * Everything else is kept in the `env` collection as {_key, value} documents
 * and merged into process.env at startup via loadEnvFromDB().
 *
 * CLI: `ohara env list|get|set|unset`
 */
import { initArangoClient } from './client.js';

const COLLECTION = 'env';

async function getDB() {
  const db = await initArangoClient();
  const coll = db.collection(COLLECTION);
  if (!(await coll.exists())) {
    await db.createCollection(COLLECTION);
  }
  return { db, coll };
}

/** Merge all stored env vars into process.env. Call once at startup. */
export async function loadEnvFromDB() {
  try {
    const { db } = await getDB();
    const cursor = await db.query('FOR e IN @@col RETURN e', { '@col': COLLECTION });
    const rows = await cursor.all();
    for (const row of rows) {
      // Never overwrite vars already set by .env (ARANGO_URL / GEMINI_API_KEY)
      if (!(row._key in process.env)) {
        process.env[row._key] = String(row.value ?? '');
      }
    }
    return rows.length;
  } catch {
    // DB not available yet or collection missing — silently skip
    return 0;
  }
}

/** Return all stored env entries as [{key, value}]. */
export async function listEnv() {
  const { db } = await getDB();
  const cursor = await db.query(
    'FOR e IN @@col SORT e._key ASC RETURN {key: e._key, value: e.value}',
    { '@col': COLLECTION }
  );
  return cursor.all();
}

/** Get a single value (or null). */
export async function getEnv(key) {
  const { coll } = await getDB();
  const doc = await coll.document(key).catch(() => null);
  return doc ? doc.value : null;
}

/** Set / upsert a key. */
export async function setEnv(key, value) {
  if (key === 'ARANGO_URL' || key === 'GEMINI_API_KEY') {
    throw new Error(`${key} must stay in .env — it is required before the DB is available.`);
  }
  const { coll } = await getDB();
  await coll.save({ _key: key, value: String(value) }, { overwriteMode: 'replace' });
  process.env[key] = String(value);
}

/** Remove a key. */
export async function unsetEnv(key) {
  const { coll } = await getDB();
  await coll.remove(key).catch(() => {});
  delete process.env[key];
}
