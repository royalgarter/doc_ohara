import fs from 'fs';
import { RdfXmlParser } from 'rdfxml-streaming-parser';

// Initialize the RDF/XML streaming parser
const parser = new RdfXmlParser({ baseIRI: 'http://ontologyportal.org' });
// Resolve file path relative to this module
const filePath = new URL('../ontology/SUMO.owl', import.meta.url).pathname;
const fileStream = fs.createReadStream(filePath);

const nodes = new Map();
const edges = [];
let edgeCounter = 0;

// Helper: get local name from a URI (after '#' or last '/')
function getKey(uri) {
	if (!uri || uri.startsWith('_:')) return null; // Ignore blank nodes
	return uri.includes('#') ? uri.split('#').pop() : uri.split('/').pop();
}
function localName(uri) {
	if (!uri) return '';
	return uri.includes('#') ? uri.split('#').pop() : uri.split('/').pop();
}

// Pipe the file stream directly into the RDF/XML parser
fileStream.pipe(parser);

// Process each triple (quad) as it is parsed from the XML structure
parser.on('data', (quad) => {
	const subjValue = quad.subject && quad.subject.value;
	const predValue = quad.predicate && quad.predicate.value;
	const objValue = quad.object && quad.object.value;

	const subjKey = getKey(subjValue);
	const objKey = getKey(objValue);
	const predLocal = localName(predValue).toLowerCase();

	// 1. Extract Classes (Nodes)
	if (predLocal === 'type' && objValue && /class$/i.test(localName(objValue))) {
		if (subjKey && !nodes.has(subjKey)) {
			nodes.set(subjKey, {
				_key: subjKey,
				uri: subjValue,
				label: subjKey,
				type: 'Class'
			});
		}
	}

	// 2. Extract SubClassOf Relationships (Edges)
	if (predLocal === 'subclassof' || predLocal === 'subclass') {
		if (subjKey && objKey) {
			edges.push({
				_key: `edge_${edgeCounter++}`,
				_from: `${subjKey}`,
				_to: `${objKey}`,
				type: 'is_a'
			});
			// ensure nodes exist for both ends
			if (!nodes.has(subjKey)) nodes.set(subjKey, { _key: subjKey, uri: subjValue, label: subjKey, type: 'Class' });
			if (!nodes.has(objKey)) nodes.set(objKey, { _key: objKey, uri: objValue, label: objKey, type: 'Class' });
		}
	}
});

// Handle formatting or syntax errors in the XML file
parser.on('error', (error) => {
	console.error('Error parsing OWL file:', error);
});

// Triggered automatically when the entire file has been successfully read
parser.on('end', () => {
	const nodeArray = Array.from(nodes.values());

	fs.writeFileSync('sumo_nodes.json', JSON.stringify(nodeArray, null, 2));
	fs.writeFileSync('sumo_edges.json', JSON.stringify(edges, null, 2));

	// Build a lightweight SUMO index for quick validation/lookups
	try {
		const sumoIndex = nodeArray.map(n => ({ localName: n._key, uri: n.uri, label: n.label || n._key }));
		// deduplicate by localName
		const byName = new Map();
		for (const s of sumoIndex) {
			if (!byName.has(s.localName)) byName.set(s.localName, s);
		}
		const indexArr = Array.from(byName.values());
		const refsPath = new URL('../ontology/sumo_index.json', import.meta.url).pathname;
		fs.writeFileSync(refsPath, JSON.stringify(indexArr, null, 2));
		console.log(`Wrote SUMO index to ontology/sumo_index.json (${indexArr.length} entries)`);
	} catch (err) {
		console.error('Failed to write SUMO index:', err.message);
	}

	console.log(`Extraction complete!`);
	console.log(`Generated: ${nodeArray.length} nodes and ${edges.length} edges.`);
});
