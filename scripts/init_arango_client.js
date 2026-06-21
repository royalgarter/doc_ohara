import dotenv from 'dotenv';
import * as client from '../src/arango_client.js';

dotenv.config();
(async ()=>{
  try{
    const db = await client.initArangoClient();
    console.log('initArangoClient succeeded');
    const colls = await db.listCollections();
    console.log('collections now:', colls.map(c=>c.name));
  } catch (e) {
    console.error('init failed:', e.message);
    process.exit(1);
  }
})();
