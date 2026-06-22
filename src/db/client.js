import { Database } from 'arangojs';

let db = null;
let initialized = false;

export async function initArangoClient() {
  if (initialized) return db;
  const raw = process.env.ARANGO_URL;
  if (!raw) throw new Error('ARANGO_URL not set in environment');

  // Parse URL to extract credentials and database name if embedded
  let baseUrl = raw;
  let dbName = undefined;
  try {
    const u = new URL(raw);
    baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    dbName = (u.pathname && u.pathname !== '/') ? u.pathname.replace(/^\/+/, '') : undefined;
    // prefer creds from URL if present
    if (u.username) process.env.ARANGO_USER = process.env.ARANGO_USER || u.username;
    if (u.password) process.env.ARANGO_PASSWORD = process.env.ARANGO_PASSWORD || u.password;
  } catch (e) {
    // If URL parsing fails, fall back to raw
    baseUrl = raw;
  }

  const username = process.env.ARANGO_USER || process.env.ARANGO_USERNAME || '';
  const password = process.env.ARANGO_PASSWORD || '';

  db = new Database({ url: baseUrl, databaseName: dbName });
  if (username) db.useBasicAuth(username, password);

  // ensure collections exist
  const docCollections = ['documents', 'sections', 'paragraphs', 'tables', 'llm_cache'];
  for (const name of docCollections) {
    const coll = db.collection(name);
    const exists = await coll.exists().catch(() => false);
    if (!exists) {
      await db.createCollection(name).catch(err => { throw err; });
    }
  }

  // Edge collection: ensure it's an edge collection. If an existing 'edges' collection is a document collection,
  // rename it to preserve old data and create a proper edge collection named 'edges'.
  const edgeColl = db.collection('edges');
  const edgeExists = await edgeColl.exists().catch(() => false);
  if (edgeExists) {
    // inspect type
    const info = await edgeColl.get();
    // In arangojs, collection type 3 == edge collection
    if (info.type !== 3) {
      const backupName = `edges_old_${Date.now()}`;
      try {
        await edgeColl.rename(backupName);
        // create new edge collection
        await db.createEdgeCollection('edges');
        console.warn(`Renamed existing 'edges' collection to '${backupName}' and created new edge collection 'edges'.`);
      } catch (err) {
        throw new Error(`Failed to migrate existing 'edges' collection to edge collection: ${err.message}`);
      }
    }
  } else {
    await db.createEdgeCollection('edges').catch(err => { throw err; });
  }

  initialized = true;
  return db;
}

function pickKey(obj, key) {
  return obj._key || obj._id || key;
}

export async function insertDocument(doc) {
  if (!initialized) await initArangoClient();
  const coll = db.collection('documents');
  const res = await coll.save(doc);
  // res._key, res._id
  return { _key: res._key, _id: res._id };
}

export async function insertSection(sec) {
  if (!initialized) await initArangoClient();
  const coll = db.collection('sections');
  const res = await coll.save(sec);
  return { _key: res._key, _id: res._id };
}

export async function insertParagraph(p) {
  if (!initialized) await initArangoClient();
  const coll = db.collection('paragraphs');
  const res = await coll.save(p);
  return { _key: res._key, _id: res._id };
}

export async function insertTable(t) {
  if (!initialized) await initArangoClient();
  const coll = db.collection('tables');
  const res = await coll.save(t);
  return { _key: res._key, _id: res._id };
}

export async function insertEdge(edge) {
  if (!initialized) await initArangoClient();
  const coll = db.collection('edges');
  const res = await coll.save(edge);
  return { _key: res._key, _id: res._id };
}

// Returns a {getState()} adapter over real ArangoDB so QuartzExporter works unchanged.
export function realDBAdapter() {
  return {
    async getState() {
      await initArangoClient();
      const [documents, sections, paragraphs, tables, edges] = await Promise.all([
        db.query('FOR d IN documents RETURN d').then(c => c.all()),
        db.query('FOR s IN sections RETURN s').then(c => c.all()),
        db.query('FOR p IN paragraphs RETURN p').then(c => c.all()),
        db.query('FOR t IN tables RETURN t').then(c => c.all()),
        db.query('FOR e IN edges RETURN e').then(c => c.all()),
      ]);
      return { documents, sections, paragraphs, tables, edges };
    },
  };
}

export async function findDocumentByHash(fileHash) {
  if (!initialized) await initArangoClient();
  const cursor = await db.query(
    'FOR d IN documents FILTER d.file_hash == @hash LIMIT 1 RETURN d',
    { hash: fileHash }
  );
  return cursor.next();
}

export async function listDocuments() {
  if (!initialized) await initArangoClient();
  const cursor = await db.query('FOR d IN documents SORT d._key DESC RETURN d');
  return cursor.all();
}

export async function deleteDocumentAndNodes(docKey) {
  if (!initialized) await initArangoClient();
  // Remove paragraphs, sections, tables, edges belonging to this document
  await db.query('FOR p IN paragraphs FILTER p.document_id == @k REMOVE p IN paragraphs', { k: docKey }).catch(() => {});
  await db.query('FOR s IN sections FILTER s.document_id == @k REMOVE s IN sections', { k: docKey }).catch(() => {});
  await db.query('FOR t IN tables FILTER t.document_id == @k REMOVE t IN tables', { k: docKey }).catch(() => {});
  await db.query(
    'FOR e IN edges FILTER e._from == CONCAT("documents/", @k) OR e._to == CONCAT("documents/", @k) REMOVE e IN edges',
    { k: docKey }
  ).catch(() => {});
  const coll = db.collection('documents');
  await coll.remove(docKey).catch(() => {});
  return true;
}

export async function getStats() {
  if (!initialized) await initArangoClient();
  const [docs, sections, paragraphs, tables, edges] = await Promise.all([
    db.query('RETURN LENGTH(documents)').then(c => c.next()),
    db.query('RETURN LENGTH(sections)').then(c => c.next()),
    db.query('RETURN LENGTH(paragraphs)').then(c => c.next()),
    db.query('RETURN LENGTH(tables)').then(c => c.next()),
    db.query('RETURN LENGTH(edges)').then(c => c.next()),
  ]);
  return { documents: docs, sections, paragraphs, tables, edges };
}

export async function close() {
  db = null;
  initialized = false;
}
