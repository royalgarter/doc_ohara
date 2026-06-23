import dotenv from 'dotenv';
import fs from 'fs';
import * as ac from '../src/db/client.js';

dotenv.config();
(async ()=>{
  try{
    await ac.initArangoClient();
    const db = await ac.initArangoClient();
    const coll = db.collection('llm_cache');
    const files = fs.readdirSync('.ohara_llm_cache').filter(f=>f.endsWith('.json'));
    console.log('syncing', files.length, 'cache files');
    for (const f of files) {
      const key = f.replace(/.json$/, '');
      const doc = JSON.parse(fs.readFileSync('.ohara_llm_cache/' + f, 'utf-8'));
      try {
        await coll.replace(key, Object.assign({_key: key}, doc)).catch(async () => { await coll.save(Object.assign({_key: key}, doc)); });
      } catch (e) {
        console.error('err saving', key, e.message);
      }
    }
    console.log('done');
  } catch(e){ console.error('sync failed', e.message); process.exit(1);} 
})();
