#!/usr/bin/env node
/**
 * Removes opaque-identifier noise entities (hashes, UUIDs, addresses, etc. that
 * LLM extraction mistook for named entities — see src/entities.js isOpaqueToken)
 * from already-ingested data: the entities collection, MENTIONS/RELATED_TO edges,
 * and the entity_slugs rollup arrays on paragraphs and documents.
 *
 * Usage:
 *   node scripts/clean_noise_entities.js --dry-run   # preview only, no mutation
 *   node scripts/clean_noise_entities.js             # apply
 */

import { initArangoClient } from '../src/db/client.js';
import { isOpaqueToken } from '../src/entities.js';

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await initArangoClient();

  const entitiesCursor = await db.query(`FOR e IN entities RETURN e`);
  const entities = await entitiesCursor.all();
  const noise = entities.filter(e => isOpaqueToken(e.canonical || e.name || e._key));

  if (noise.length === 0) {
    console.log('No noise entities found.');
    return;
  }

  console.log(`Found ${noise.length} noise entity/entities${dryRun ? ' (dry run — no changes will be made)' : ''}:`);
  for (const e of noise) console.log(`  ${e._key}  "${e.name || e.canonical}"  (${e.type})`);

  if (dryRun) return;

  const noiseSlugs = noise.map(e => e._key);

  // Remove MENTIONS edges (paragraph → entity) and RELATED_TO edges (entity ↔ entity)
  for (const e of noise) {
    await db.query({
      query: `FOR ed IN edges FILTER ed._to == @id OR ed._from == @id REMOVE ed IN edges`,
      bindVars: { id: e._id },
    });
  }

  // Strip noise slugs from paragraph and document entity_slugs rollups
  for (const collection of ['paragraphs', 'documents']) {
    const cursor = await db.query(`
      FOR d IN ${collection}
        FILTER LENGTH(INTERSECTION(d.entity_slugs, @slugs)) > 0
        RETURN d
    `, { slugs: noiseSlugs });
    const affected = await cursor.all();
    for (const doc of affected) {
      const cleaned = (doc.entity_slugs || []).filter(s => !noiseSlugs.includes(s));
      await db.query({
        query: `UPDATE @key WITH { entity_slugs: @slugs } IN ${collection}`,
        bindVars: { key: doc._key, slugs: cleaned },
      });
    }
    console.log(`  Cleaned entity_slugs on ${affected.length} ${collection} record(s).`);
  }

  // Remove the noise entity nodes themselves
  for (const e of noise) {
    await db.query({ query: `REMOVE @key IN entities`, bindVars: { key: e._key } });
  }

  console.log(`Removed ${noise.length} noise entity/entities.`);
}

run().catch(err => { console.error(err.message); process.exit(1); });
