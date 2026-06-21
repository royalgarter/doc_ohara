import dotenv from 'dotenv'; dotenv.config();
import { Database } from 'arangojs';
(async ()=>{
  try{
    const u = new URL(process.env.ARANGO_URL);
    const base = u.protocol + '//' + u.hostname + (u.port ? ':'+u.port : '');
    const dbName = (u.pathname && u.pathname!='/') ? u.pathname.replace(/^\/+/, '') : undefined;
    const db = new Database({ url: base, databaseName: dbName });
    if (u.username) db.useBasicAuth(u.username, u.password);
    const r = await db.query('RETURN LENGTH(FOR e IN edges RETURN 1)');
    const rows = await r.all();
    console.log('edges count total:', rows[0]);
    const cur = await db.query('FOR e IN edges LIMIT 5 RETURN e');
    const sample = await cur.all();
    console.log('sample edges:', sample.map(s=>({id:s._id, rel:s.relation, from:s._from, to:s._to})));
  } catch(e) { console.error('ERR', e.message); process.exit(1);} 
})();
