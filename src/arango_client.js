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

export async function close() {
  // arangojs has no explicit close
  db = null;
  initialized = false;
}
