import dotenv from 'dotenv'; dotenv.config();
import { Database } from 'arangojs';
(async ()=>{ try{
  const u=new URL(process.env.ARANGO_URL);
  const base=u.protocol+'//'+u.hostname+(u.port?':'+u.port:'');
  const dbName=(u.pathname && u.pathname!='/')?u.pathname.replace(/^\/+/, ''):undefined;
  const db=new Database({url:base,databaseName:dbName}); if(u.username) db.useBasicAuth(u.username,u.password);
  const docs = await db.query('FOR d IN documents FILTER d.source_file==@s LIMIT 1 RETURN d',{s:'Mastering Bitcoin 2nd.md'});
  const arr = await docs.all(); if(arr.length===0){ console.log('no doc'); return; }
  const doc=arr[0];
  console.log('doc id/key', doc._id, doc._key);
  const sec = await db.query('FOR s IN sections FILTER s.document_id==@k LIMIT 1 RETURN s',{k:doc._key});
  const secs=await sec.all(); if(secs.length===0){ console.log('no section'); return; }
  const sec0=secs[0];
  console.log('sec id/key', sec0._id, sec0._key);
  const res = await db.query('INSERT {_from:@f,_to:@t, relation:@r} INTO edges RETURN {from:NEW._from, to:NEW._to, new:NEW._key}',{f:doc._id, t:sec0._id, r:'TEST_EDGE2'});
  const newEdge=(await res.all())[0];
  console.log('aql newEdge', newEdge);
} catch(e){ console.error(e); process.exit(1);} })();