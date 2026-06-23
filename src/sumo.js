import fs from 'fs';
import path from 'path';

const SUMO_INDEX_PATH = path.join(process.cwd(), 'ontology', 'sumo_index.json');
let index = null;

// Common aliases: terms LLMs frequently emit → canonical SUMO local names.
// Values are arrays so one alias can resolve to multiple candidates (first valid wins).
const ALIASES = {
  'bitcoin': ['Currency', 'DigitalData'],
  'blockchain': ['DigitalData', 'Database'],
  'cryptocurrency': ['Currency'],
  'money': ['Currency', 'FinancialInstrument'],
  'transaction': ['Transaction', 'FinancialTransaction'],
  'financialtransaction': ['FinancialTransaction', 'Transaction'],
  'text': ['Text', 'ContentBearingObject'],
  'number': ['Number', 'Quantity'],
  'quantity': ['Quantity', 'Number'],
  'date': ['TimePoint', 'TimeInterval'],
  'time': ['TimePoint', 'TimeInterval', 'TimeDuration'],
  'person': ['Human', 'Agent'],
  'human': ['Human'],
  'organization': ['Organization', 'Agent'],
  'company': ['Organization', 'Corporation'],
  'agent': ['Agent'],
  'process': ['Process'],
  'action': ['Action', 'Process'],
  'event': ['Process', 'SocialInteraction'],
  'location': ['GeographicArea', 'Region'],
  'place': ['GeographicArea', 'Region'],
  'region': ['Region', 'GeographicArea'],
  'country': ['Nation'],
  'language': ['Language', 'LinguisticExpression'],
  'document': ['Text', 'ContentBearingObject'],
  'book': ['Book', 'Text'],
  'article': ['Article', 'Text'],
  'equation': ['Formula', 'Proposition'],
  'formula': ['Formula'],
  'table': ['Array', 'ContentBearingObject'],
  'figure': ['ContentBearingObject', 'Depiction'],
  'network': ['ComputerNetwork', 'Graph'],
  'database': ['Database'],
  'software': ['ComputerProgram', 'Artifact'],
  'algorithm': ['ComputerProgram', 'Procedure'],
  'key': ['EncodingKey', 'SymmetricKey'],
  'hash': ['Function', 'ComputerProgram'],
  'signature': ['DigitalSignature', 'Signature'],
  'address': ['NetworkAddress', 'StreetAddress'],
  'wallet': ['Container', 'ComputerProgram'],
  'node': ['ComputerNetwork', 'Graph'],
  'peer': ['Agent', 'ComputerNetwork'],
  'protocol': ['Procedure', 'ComputerProgram'],
};

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

// Strip underscores, hyphens, spaces and lowercase for comparison.
function normalize(s) {
  return String(s).toLowerCase().replace(/[_\s-]/g, '');
}

// Returns the canonical localName for a tag, or null if no match found.
// Resolution order:
//   1. exact match
//   2. case + separator insensitive exact
//   3. alias table lookup → first candidate that exists in index
export function resolveTag(tag) {
  if (!tag) return null;
  const idx = loadSumoIndex();
  const t = String(tag).trim();
  const norm = normalize(t);

  // 1. exact
  if (idx.some(e => e.localName === t)) return t;

  // 2. case + separator insensitive
  const ci = idx.find(e => normalize(e.localName) === norm);
  if (ci) return ci.localName;

  // 3. alias table
  const candidates = ALIASES[norm] || ALIASES[t.toLowerCase()];
  if (candidates) {
    for (const c of candidates) {
      if (idx.some(e => e.localName === c)) return c;
    }
  }

  return null;
}

export function isValidTag(tag) {
  return resolveTag(tag) !== null;
}

// Validates an array of candidate tags.
// Returns:
//   valid   – canonical localNames for all resolved tags
//   invalid – original strings that could not be resolved
//   resolved_map – original → canonical mapping for provenance
export function validateTags(tags) {
  if (!Array.isArray(tags)) return { valid: [], invalid: [], resolved_map: {} };
  const valid = [];
  const invalid = [];
  const resolved_map = {};
  for (const t of tags) {
    const canonical = resolveTag(t);
    if (canonical) {
      valid.push(canonical);
      if (canonical !== t) resolved_map[t] = canonical;
    } else {
      invalid.push(t);
    }
  }
  return { valid, invalid, resolved_map };
}

export default { loadSumoIndex, resolveTag, isValidTag, validateTags };
