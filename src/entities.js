export const VALID_ENTITY_TYPES = new Set(['PERSON', 'ORG', 'LOCATION', 'DATE', 'TECH', 'AMOUNT', 'EVENT', 'CONCEPT']);

/**
 * Converts a canonical entity name to a stable ArangoDB key.
 * e.g. "Bitcoin Network" → "bitcoin-network"
 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalization key used for dedup comparison (ignores punctuation/case/spacing).
 */
function normalizeEntity(canonical) {
  return canonical.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Detects opaque, machine-generated identifier tokens (hashes, UUIDs, addresses,
 * base58/base64-ish strings, etc.) that LLM extraction sometimes mistakes for
 * named entities. Deliberately domain-agnostic — not specific to any one kind
 * of document or identifier scheme.
 */
function isOpaqueToken(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!s) return false;

  // UUID shape (hyphenated hex) — checked first since it contains hyphens.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;

  if (/\s/.test(s)) return false;          // real names/phrases usually have whitespace
  if (s.length < 20) return false;          // short tokens are unlikely to be noise

  if (/^[0-9a-f]{16,}$/i.test(s)) return true; // pure hex hash/id

  if (!/^[A-Za-z0-9]+$/.test(s)) return false; // not a single opaque alnum run

  // Vowel-ratio heuristic: real words/phrases carry vowels; base58/base64-style
  // opaque tokens are vowel-sparse high-entropy runs.
  const vowels = (s.match(/[aeiou]/gi) || []).length;
  return (vowels / s.length) < 0.15;
}

/**
 * Validates and cleans a single raw entity object from LLM output.
 * Returns null if the entity is malformed or looks like an opaque identifier.
 */
function validateEntity(raw) {
  if (!raw || typeof raw.canonical !== 'string' || !raw.canonical.trim()) return null;
  if (!VALID_ENTITY_TYPES.has(raw.type)) return null;

  const canonical = raw.canonical.trim();
  if (isOpaqueToken(canonical)) return null;

  const name = (typeof raw.name === 'string' && raw.name.trim()) ? raw.name.trim() : canonical;
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter(a => typeof a === 'string' && a.trim() && !isOpaqueToken(a.trim())).map(a => a.trim())
    : [];

  return { name, canonical, type: raw.type, aliases, slug: slugify(canonical) };
}

/**
 * Validates and deduplicates all candidate_entities on a single node.
 * Returns the cleaned array and a list of dropped invalid entries.
 */
function processNodeEntities(candidateEntities) {
  const valid = [];
  const invalid = [];
  const seen = new Map(); // normalizeKey → index in valid[]

  for (const raw of candidateEntities) {
    const entity = validateEntity(raw);
    if (!entity) {
      invalid.push(raw);
      continue;
    }
    const key = normalizeEntity(entity.canonical);
    if (seen.has(key)) {
      // Merge aliases into the existing entry
      const existing = valid[seen.get(key)];
      const newAliases = [entity.name, ...entity.aliases].filter(a => !existing.aliases.includes(a) && a !== existing.canonical);
      existing.aliases.push(...newAliases);
    } else {
      seen.set(key, valid.length);
      valid.push(entity);
    }
  }

  return { valid, invalid };
}

/**
 * Merges a list of entity objects that share the same normalised canonical name.
 * Used when consolidating entities extracted from multiple paragraphs within a doc.
 */
function mergeEntities(entityList) {
  const merged = { ...entityList[0] };
  const aliasSet = new Set(merged.aliases);
  aliasSet.add(merged.name);

  for (let i = 1; i < entityList.length; i++) {
    const e = entityList[i];
    aliasSet.add(e.name);
    for (const a of e.aliases) aliasSet.add(a);
  }

  aliasSet.delete(merged.canonical);
  merged.aliases = [...aliasSet];
  return merged;
}

/**
 * Given a list of entities from all paragraphs in a document, returns a
 * deduplicated map keyed by slug, with merged aliases and mention counts.
 */
function buildDocumentEntityMap(paragraphEntityArrays) {
  const byNorm = new Map(); // normKey → { entity, count }

  for (const entities of paragraphEntityArrays) {
    for (const entity of entities) {
      const key = normalizeEntity(entity.canonical);
      if (byNorm.has(key)) {
        const entry = byNorm.get(key);
        entry.count += 1;
        const aliasSet = new Set(entry.entity.aliases);
        aliasSet.add(entity.name);
        for (const a of entity.aliases) aliasSet.add(a);
        aliasSet.delete(entry.entity.canonical);
        entry.entity.aliases = [...aliasSet];
      } else {
        byNorm.set(key, { entity: { ...entity }, count: 1 });
      }
    }
  }

  return byNorm;
}

export { slugify, normalizeEntity, validateEntity, processNodeEntities, mergeEntities, buildDocumentEntityMap, isOpaqueToken };
