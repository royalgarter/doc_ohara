import dotenv from 'dotenv'; dotenv.config();
import * as ac from '../src/arango_client.js';
(async ()=>{
  try{
    await ac.initArangoClient();
    const doc = await ac.insertDocument({ source_file: 'edge_test.md', parser_engine: 'test', title: 'Edge Test', file_size: '1KB', upload_time: new Date().toISOString() });
    console.log('doc', doc);
    const sec = await ac.insertSection({ document_id: doc._key, title: 'Sec A', level: 1 });
    console.log('sec', sec);
    const docHandle = doc._id || `documents/${doc._key}`;
    const secHandle = sec._id || `sections/${sec._key}`;
    console.log('handles', docHandle, secHandle);
    const edge = await ac.insertEdge({ _from: docHandle, _to: secHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' });
    console.log('edge', edge);
    // fetch edge by key
    const db = await ac.initArangoClient();
    const coll = db.collection('edges');
    const fetched = await coll.document(edge._key);
    console.log('edge fetched', fetched);
  } catch(e){ console.error('ERR', e); process.exit(1);} 
})();
