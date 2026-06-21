import fs from 'fs';
import path from 'path';

const SUMO_INDEX_PATH = path.join(process.cwd(), 'refs', 'sumo_index.json');
let index = null;

export function loadSumoIndex() {
  if (index) return index;
  if (!fs.existsSync(SUMO_INDEX_PATH)) {
    index = [];
    return index;
  }
  try {
    const raw = fs.readFileSync(SUMO_INDEX_PATH, 'utf-8');
    index = JSON.parse(raw);
    return index;
  } catch (err) {
    console.error('Failed to load SUMO index:', err.message);
    index = [];
    return index;
  }
}

export function isValidTag(tag) {
  if (!tag) return false;
  const idx = loadSumoIndex();
  return idx.some(e => e.localName === tag || e.localName.toLowerCase() === String(tag).toLowerCase());
}

export function validateTags(tags) {
  if (!Array.isArray(tags)) return { valid: [], invalid: [] };
  const valid = [];
  const invalid = [];
  for (const t of tags) {
    if (isValidTag(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid, invalid };
}

export default { loadSumoIndex, isValidTag, validateTags };
