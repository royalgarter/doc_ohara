import { Database } from 'arangojs';

let db = null;
let initialized = false;

export async function initArangoClient() {
  if (initialized) return db;
  const url = process.env.ARANGO_URL;
  if (!url) throw new Error('ARANGO_URL not set in environment');
  const username = process.env.ARANGO_USER || process.env.ARANGO_USERNAME || '';
  const password = process.env.ARANGO_PASSWORD || '';

  db = new Database({ url });
  if (username) db.useBasicAuth(username, password);

  // ensure collections exist
  const collections = ['documents', 'sections', 'paragraphs', 'tables', 'edges'];
  for (const name of collections) {
    const exists = await db.collection(name).exists().catch(() => false);
    if (!exists) {
      await db.createCollection(name).catch(err => { throw err; });
    }
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
