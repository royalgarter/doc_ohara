import fs from 'node:fs';
import path from 'node:path';

const SUMO_INDEX_PATH = path.join(process.cwd(), 'ontology', 'sumo_index.json');
let index = null;
let exactMap = null;
let normMap = null;

// Common aliases: terms LLMs frequently emit → canonical SUMO local names.
// Values are arrays so one alias can resolve to multiple candidates (first valid wins).
const ALIASES = {
	// ── Finance / crypto ─────────────────────────────────────────────────────
	'bitcoin': ['Currency', 'FinancialInstrument'],
	'blockchain': ['Database', 'List'],
	'cryptocurrency': ['Currency', 'FinancialInstrument'],
	'digitalcurrency': ['Currency', 'FinancialInstrument'],
	'money': ['Currency', 'FinancialInstrument'],
	'transaction': ['Transaction', 'FinancialTransaction'],
	'financialtransaction': ['FinancialTransaction', 'Transaction'],
	'financialinstrument': ['FinancialInstrument'],
	'ledger': ['Record', 'Database'],
	'mining': ['Making', 'Process'],
	'proofofwork': ['Procedure', 'ComputerProgram'],
	'consensus': ['Proposition', 'Procedure'],
	'economics': ['Proposition', 'Studying'],
	'finance': ['FinancialTransaction', 'Proposition'],
	'monetarypolicy': ['Proposition', 'PoliticalProcess'],
	'amount': ['Quantity', 'PhysicalQuantity'],
	'retail': ['Selling', 'CommercialService'],

	// ── Computing / software ─────────────────────────────────────────────────
	'digitaldata': ['DataFile', 'ContentBearingObject'],
	'data': ['DataFile', 'ContentBearingObject'],
	'datastructure': ['DataStructure', 'ComputerProgram'],
	'datastucture': ['DataStructure', 'ComputerProgram'],
	'database': ['Database'],
	'software': ['ComputerProgram', 'Artifact'],
	'softwareapplication': ['ComputerProgram', 'Artifact'],
	'softwarecomponent': ['ComputerProgram', 'Artifact'],
	'softwaredevelopment': ['ComputerProgram', 'Experimenting'],
	'softwareengineering': ['ComputerProgram', 'Experimenting'],
	'programminglanguage': ['ComputerLanguage', 'Language'],
	'programmingcode': ['ComputerProgram', 'Text'],
	'algorithm': ['ComputerProgram', 'Procedure'],
	'computerprogramming': ['ComputerProgram', 'Experimenting'],
	'computerscience': ['Studying', 'Proposition'],
	'api': ['ComputerProgram', 'Procedure'],
	'command': ['Directing', 'LinguisticExpression'],
	'configuration': ['Proposition', 'ContentBearingObject'],
	'dataencoding': ['Encoding', 'Procedure'],
	'dataformat': ['ContentBearingObject', 'Proposition'],
	'datastorage': ['Database', 'MemoryDevice'],
	'datamanagement': ['Procedure', 'Database'],
	'distributedledger': ['Database', 'List'],
	'networkprotocol': ['Procedure', 'ComputerNetwork'],
	'networkaddress': ['NetworkAddress'],
	'informationtechnology': ['ComputerProgram', 'Studying'],
	'information': ['ContentBearingObject', 'Proposition'],
	'system': ['System'],
	'architecture': ['Designing', 'Plan'],
	'validation': ['Procedure', 'Investigating'],
	'version': ['Proposition', 'ContentBearingObject'],

	// ── Cryptography ─────────────────────────────────────────────────────────
	'cryptography': ['Encoding', 'Procedure'],
	'encryption': ['Encoding', 'Procedure'],
	'hashfunction': ['Function', 'ComputerProgram'],
	'cryptographichash': ['Function', 'ComputerProgram'],
	'publickey': ['Key', 'Encoding'],
	'privatekey': ['Key', 'Encoding'],
	'secretkey': ['Key', 'Encoding'],
	'ellipticcurvecryptography': ['Encoding', 'Procedure'],
	'digitalsignature': ['DigitalSignature'],
	'digitalidentity': ['SocialRole', 'Agent'],
	'digitalidentifier': ['NetworkAddress', 'ContentBearingObject'],
	'identity': ['SocialRole', 'Agent'],
	'pubkey': ['Key', 'Encoding'],
	'key': ['Key', 'Encoding'],
	'hash': ['Function', 'ComputerProgram'],
	'signature': ['DigitalSignature'],

	// ── Document / knowledge ─────────────────────────────────────────────────
	'text': ['Text', 'ContentBearingObject'],
	'document': ['Text', 'ContentBearingObject'],
	'book': ['Book', 'Text'],
	'article': ['Article', 'Text'],
	'information': ['ContentBearingObject', 'Proposition'],
	'legaldocument': ['LegalDecision', 'Text'],
	'knowledgebase': ['Database', 'ContentBearingObject'],

	// ── Math / logic ─────────────────────────────────────────────────────────
	'number': ['Number', 'Quantity'],
	'quantity': ['Quantity', 'PhysicalQuantity'],
	'equation': ['Formula', 'Proposition'],
	'formula': ['Formula', 'Proposition'],
	'mathematics': ['Proposition', 'Studying'],
	'mathematicalobject': ['SetOrClass', 'Abstract'],
	'mathematicaloperation': ['Function', 'Process'],
	'geometry': ['Proposition', 'Studying'],
	'probability': ['Quantity', 'Proposition'],
	'logic': ['Proposition', 'Studying'],
	'calculation': ['Computing', 'Process'],

	// ── Agents / social ──────────────────────────────────────────────────────
	'person': ['Human', 'Agent'],
	'human': ['Human'],
	'organization': ['Organization', 'Agent'],
	'company': ['Organization', 'Corporation'],
	'agent': ['Agent'],
	'professionalaffiliation': ['SocialRole', 'Organization'],

	// ── Time / events ────────────────────────────────────────────────────────
	'date': ['TimePoint', 'TimeInterval'],
	'time': ['TimePoint', 'TimeInterval', 'TimeDuration'],
	'timestamp': ['TimePoint'],
	'event': ['Process', 'SocialInteraction'],
	'history': ['Proposition', 'Stating'],

	// ── Places ───────────────────────────────────────────────────────────────
	'location': ['GeographicArea', 'Region'],
	'place': ['GeographicArea', 'Region'],
	'region': ['Region', 'GeographicArea'],
	'country': ['Nation'],

	// ── Physical / network infra ─────────────────────────────────────────────
	'network': ['ComputerNetwork', 'Graph'],
	'node': ['ComputerNetwork', 'Graph'],
	'peer': ['Agent', 'ComputerNetwork'],
	'protocol': ['Procedure', 'ComputerNetwork'],
	'address': ['NetworkAddress', 'StreetAddress'],
	'wallet': ['Container', 'ComputerProgram'],
	'hardware': ['Device', 'Artifact'],

	// ── Miscellaneous LLM-emitted terms ──────────────────────────────────────
	'language': ['Language', 'LinguisticExpression'],
	'process': ['Process'],
	'action': ['Action', 'Process'],
	'table': ['Array', 'ContentBearingObject'],
	'figure': ['ContentBearingObject', 'Depiction'],
	'diagram': ['ContentBearingObject', 'Depiction'],
	'service': ['CommercialService', 'Process'],
	'role': ['SocialRole'],
	'account': ['FinancialAccount', 'ContentBearingObject'],
	'backup': ['Replication', 'Procedure'],
	'privacy': ['Secrecy', 'Proposition'],
	'security': ['Security-State', 'Proposition'],
	'risk': ['SubjectiveAssessmentAttribute', 'Proposition'],
	'governance': ['PoliticalProcess', 'Procedure'],
	'standardization': ['Procedure', 'Proposition'],
	'theft': ['Theft'],
	'charity': ['Giving', 'SocialInteraction'],
	'donation': ['Giving', 'FinancialTransaction'],
};

export function loadSumoIndex() {
	if (index) return index;
	if (!fs.existsSync(SUMO_INDEX_PATH)) {
		console.warn('SUMO index not found — all tags will be treated as invalid');
		index = [];
		exactMap = new Map();
		normMap = new Map();
		return index;
	}
	try {
		const raw = fs.readFileSync(SUMO_INDEX_PATH, 'utf-8');
		index = JSON.parse(raw);
		exactMap = new Map(index.map(e => [e.localName, true]));
		normMap = new Map(index.map(e => [normalize(e.localName), e.localName]));
		return index;
	} catch (err) {
		console.error('Failed to load SUMO index:', err.message);
		index = [];
		exactMap = new Map();
		normMap = new Map();
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
//   4. CamelCase component decomposition → longest valid component wins
export function resolveTag(tag) {
	if (!tag) return null;
	loadSumoIndex(); // ensure Maps are built
	const t = String(tag).trim();
	const norm = normalize(t);

	// 1. exact — O(1)
	if (exactMap.has(t)) return t;

	// 2. case + separator insensitive — O(1)
	const ci = normMap.get(norm);
	if (ci) return ci;

	// 3. alias table
	const candidates = ALIASES[norm];
	if (candidates) {
		for (const c of candidates) {
			if (exactMap.has(c)) return c;
		}
	}

	// 4. CamelCase decomposition — split compound LLM-invented terms into their
	//    component words and resolve each. Return the longest-word valid component
	//    so "ResearchMethod" → ["Research","Method"] → "Method" (valid, 6 chars).
	//    This handles any domain without requiring manual aliases per term.
	const components = t.replace(/([A-Z])/g, ' $1').trim().split(/\s+/).filter(w => w.length >= 3);
	if (components.length > 1) {
		// Sort by word length descending — prefer longer, more specific components
		const sorted = [...components].sort((a, b) => b.length - a.length);
		for (const word of sorted) {
			const wNorm = normalize(word);
			const wExact = normMap.get(wNorm);
			if (wExact) return wExact;
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
	return { valid: [...new Set(valid)], invalid, resolved_map };
}

// ── SUMO hierarchy: ancestor traversal + distance ────────────────────────────

const SUMO_HIERARCHY_PATH = path.join(process.cwd(), 'ontology', 'sumo_hierarchy.json');
let hierarchyMap = null;

function loadHierarchy() {
	if (hierarchyMap) return hierarchyMap;
	try {
		hierarchyMap = JSON.parse(fs.readFileSync(SUMO_HIERARCHY_PATH, 'utf-8'));
	} catch (_) {
		hierarchyMap = {}; // hierarchy file not yet generated — degrade gracefully
	}
	return hierarchyMap;
}

/**
 * Return all ancestors of `tag` via BFS on the subClassOf hierarchy.
 * Does NOT include `tag` itself. Returns a Map<ancestor, distance> where
 * distance is the number of hops from `tag`.
 * Returns an empty Map if tag not found or hierarchy unavailable.
 */
export function sumoAncestors(tag) {
	const parents = loadHierarchy();
	const result = new Map(); // ancestor → distance
	const queue = [[tag, 0]];
	const visited = new Set([tag]);
	while (queue.length) {
		const [cur, dist] = queue.shift();
		for (const parent of (parents[cur] || [])) {
			if (visited.has(parent)) continue;
			visited.add(parent);
			result.set(parent, dist + 1);
			queue.push([parent, dist + 1]);
		}
	}
	return result;
}

/**
 * Shortest ancestor distance between two tags.
 * Returns 0 if identical, positive int if one is an ancestor of the other,
 * or -1 if no relation found (within maxDepth hops).
 */
export function sumoDistance(tagA, tagB, maxDepth = 6) {
	if (tagA === tagB) return 0;
	const ancsA = sumoAncestors(tagA);
	// Direct ancestor relationship
	if (ancsA.has(tagB)) return ancsA.get(tagB);
	const ancsB = sumoAncestors(tagB);
	if (ancsB.has(tagA)) return ancsB.get(tagA);
	// Common ancestor: find minimum sum of distances
	let minDist = -1;
	for (const [anc, dA] of ancsA) {
		if (dA > maxDepth) continue;
		const dB = ancsB.get(anc);
		if (dB !== undefined && dB <= maxDepth) {
			const total = dA + dB;
			if (minDist === -1 || total < minDist) minDist = total;
		}
	}
	return minDist;
}

export default { loadSumoIndex, resolveTag, isValidTag, validateTags, sumoAncestors, sumoDistance };
