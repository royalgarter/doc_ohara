import { Database } from 'arangojs';
import { readFileSync, writeFileSync } from 'fs';

const env = readFileSync('/home/ubuntu/src/doc_ohara/.env', 'utf8');
env.split('\n').forEach(line => {
	const m = line.match(/^([^#=]+)=(.*)$/);
	if (m) process.env[m[1].trim()] = m[2].trim();
});

const raw = process.env.ARANGO_URL;
const u = new URL(raw);
const db = new Database({ url: `${u.protocol}//${u.hostname}`, databaseName: u.pathname.replace(/^\/+/, '') });
db.useBasicAuth(u.username, u.password);

const DOC_KEY = '331070167';
const out = [];
const log = (...args) => { const s = args.join(' '); console.log(s); out.push(s); };

log('=== BITCOIN INGEST VERIFICATION ===');
log(`Date: ${new Date().toISOString()}`);
log('');

// 1. Document record
log('--- 1. DOCUMENT RECORD ---');
const doc = await db.collection('documents').document(DOC_KEY);
log(`Title: ${doc.title}`);
log(`Source: ${doc.source_file}`);
log(`Parser: ${doc.parser_engine}`);
log(`Status: ${doc.ingestion_status}`);
log(`Error: ${doc.ingestion_error}`);
log(`Chunks: ${doc.completed_chunks}/${doc.total_chunks}`);
log(`Entity count: ${doc.entity_count}`);
log(`SUMO tags count: ${doc.sumo_tags?.length}`);
log(`Decay class: ${doc.effective_decay_class}`);
log(`Temporal: ${doc.temporal_coverage_start} -> ${doc.temporal_coverage_end}`);
log(`TOC source: ${doc.toc_source}`);
log(`TOC entries count: ${doc.toc_entries?.length}`);
log('');

log('--- 2. TOC ENTRIES ---');
doc.toc_entries?.forEach(e => log(`  [L${e.level}] p.${e.page}: ${e.title}`));
log('');

log('--- 3. SECTIONS ANALYSIS ---');
const secByLevel = await (await db.query(`
	FOR s IN sections
	FILTER s.document_id == @k
	COLLECT level = s.level WITH COUNT INTO cnt
	SORT level
	RETURN {level, cnt}`, {k: DOC_KEY})).all();
log('Sections by level:', JSON.stringify(secByLevel));

const totalSec = await (await db.query(`RETURN LENGTH(FOR s IN sections FILTER s.document_id == @k RETURN 1)`, {k: DOC_KEY})).next();
log(`Total sections: ${totalSec}`);

const chapters = await (await db.query(`
	FOR s IN sections
	FILTER s.document_id == @k AND s.level == 1
	LIMIT 30
	RETURN {title: s.title}`, {k: DOC_KEY})).all();
log('Level-1 sections:');
chapters.forEach(c => log(`  ${c.title}`));
log('');

log('--- 4. PARAGRAPH ANALYSIS ---');
const parTotal = await (await db.query(`RETURN LENGTH(FOR p IN paragraphs FILTER p.document_id == @k RETURN 1)`, {k: DOC_KEY})).next();
log(`Total paragraphs: ${parTotal}`);

const parStats = await (await db.query(`
	LET with_sumo = LENGTH(FOR p IN paragraphs FILTER p.document_id == @k AND LENGTH(p.sumo_tags) > 0 RETURN 1)
	LET with_entities = LENGTH(FOR p IN paragraphs FILTER p.document_id == @k AND LENGTH(p.entity_slugs) > 0 RETURN 1)
	LET empty_content = LENGTH(FOR p IN paragraphs FILTER p.document_id == @k AND (p.content == null OR p.content == '') RETURN 1)
	LET with_section = LENGTH(FOR p IN paragraphs FILTER p.document_id == @k AND p.section_id != null RETURN 1)
	RETURN {with_sumo, with_entities, empty_content, with_section}`, {k: DOC_KEY})).next();
log('Paragraph enrichment:', JSON.stringify(parStats));

const shortPars = await (await db.query(`
	FOR p IN paragraphs
	FILTER p.document_id == @k AND LENGTH(p.content) < 20
	LIMIT 20
	RETURN {key: p._key, content: p.content, len: LENGTH(p.content)}`, {k: DOC_KEY})).all();
log(`Short paragraphs (<20 chars): ${shortPars.length}`);
shortPars.forEach(p => log(`  [${p.key}] len=${p.len}: "${p.content}"`));
log('');

log('--- 5. EDGE ANALYSIS ---');
const edges = await (await db.query(`
	LET doc_id = CONCAT('documents/', @k)
	LET sec_ids = (FOR s IN sections FILTER s.document_id == @k RETURN s._id)
	LET par_ids = (FOR p IN paragraphs FILTER p.document_id == @k RETURN p._id)
	LET all_ids = APPEND(APPEND([doc_id], sec_ids), par_ids)
	FOR e IN edges
	FILTER e._from IN all_ids OR e._to IN all_ids
	COLLECT rel = e.relation WITH COUNT INTO cnt
	SORT cnt DESC
	RETURN {rel, cnt}`, {k: DOC_KEY})).all();
log('Edge types:', JSON.stringify(edges));
log('');

log('--- 6. ENTITY ANALYSIS ---');
const entByType = await (await db.query(`
	FOR e IN entities
	FILTER @k IN e.document_ids
	COLLECT type = e.type WITH COUNT INTO cnt
	SORT cnt DESC
	RETURN {type, cnt}`, {k: DOC_KEY})).all();
log('Entities by type:', JSON.stringify(entByType));
log('');

log('--- 7. CONTENT SPOT-CHECK ---');
const concepts = ['proof-of-work', 'elliptic curve', 'merkle', 'blockchain', 'mining', 'wallet', 'transaction', 'private key'];
for (const concept of concepts) {
	const cnt = await (await db.query(`
		RETURN LENGTH(FOR p IN paragraphs
		FILTER p.document_id == @k AND CONTAINS(LOWER(p.content), @concept)
		RETURN 1)`, {k: DOC_KEY, concept})).next();
	log(`  "${concept}": ${cnt} paragraphs`);
}
log('');

log('--- 8. HIERARCHY EDGE COUNTS ---');
const hier = await (await db.query(`
	LET sec_ids = (FOR s IN sections FILTER s.document_id == @k RETURN s._id)
	LET par_ids = (FOR p IN paragraphs FILTER p.document_id == @k RETURN p._id)
	LET all_ids = APPEND(sec_ids, par_ids)
	LET has_child = LENGTH(FOR e IN edges FILTER e.relation == 'HAS_CHILD' AND (e._from IN all_ids OR e._to IN all_ids) RETURN 1)
	LET next_sib = LENGTH(FOR e IN edges FILTER e.relation == 'NEXT_SIBLING' AND (e._from IN all_ids OR e._to IN all_ids) RETURN 1)
	LET belongs_to = LENGTH(FOR e IN edges FILTER e.relation == 'BELONGS_TO' AND (e._from IN all_ids OR e._to IN all_ids) RETURN 1)
	LET mentions = LENGTH(FOR e IN edges FILTER e.relation == 'MENTIONS' AND (e._from IN all_ids OR e._to IN all_ids) RETURN 1)
	RETURN {has_child, next_sibling: next_sib, belongs_to, mentions}`, {k: DOC_KEY})).next();
log('Hierarchy edge counts:', JSON.stringify(hier));
log('');

log('--- 9. CROSS-DOC SIMILARITY ---');
const simEdges = await (await db.query(`
	LET doc_id = CONCAT('documents/', @k)
	FOR e IN edges
	FILTER e.relation == 'SIMILAR_TO' AND (e._from == doc_id OR e._to == doc_id)
	LET other = e._from == doc_id ? e._to : e._from
	LET otherDoc = DOCUMENT(other)
	RETURN {other: otherDoc.title, weight: e.weight, verb: e.verb, summary: LEFT(e.summary, 120)}`, {k: DOC_KEY})).all();
log(`SIMILAR_TO edges: ${simEdges.length}`);
simEdges.forEach(e => log(`  -> "${e.other}" (w=${e.weight}) [${e.verb}] ${e.summary}`));
log('');

log('--- 10. PARAGRAPH CONTENT SAMPLE ---');
const parSample = await (await db.query(`
	FOR p IN paragraphs
	FILTER p.document_id == @k
	LIMIT 10
	RETURN {key: p._key, content: LEFT(p.content, 200), sumo: p.sumo_tags, entities: LENGTH(p.entity_slugs)}`, {k: DOC_KEY})).all();
parSample.forEach((p, i) => {
	log(`  [${i+1}] key=${p.key} entities=${p.entities} sumo=${JSON.stringify(p.sumo)}`);
	log(`       "${p.content}"`);
});
log('');

log('--- 11. LLM USAGE ---');
log(`Model: ${doc.llm_usage?.model}`);
log(`Total tokens: ${doc.llm_usage?.total_tokens}`);
log(`Chunks: ${doc.llm_usage?.chunks}, Cache hits: ${doc.llm_usage?.cache_hits}`);
log(`Cache rate: ${((doc.llm_usage?.cache_hits / doc.llm_usage?.chunks) * 100).toFixed(1)}%`);
log('');

log('=== VERIFICATION COMPLETE ===');

writeFileSync('/tmp/bitcoin_verify_result.txt', out.join('\n'));
console.log('\nSaved -> /tmp/bitcoin_verify_result.txt');
