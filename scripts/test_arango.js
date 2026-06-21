import dotenv from 'dotenv';
import { Database } from 'arangojs';

dotenv.config();
(async ()=>{
  try {
    const raw = process.env.ARANGO_URL;
    if (!raw) { console.error('ARANGO_URL not set'); process.exit(1); }
    const u = new URL(raw);
    const baseUrl = u.protocol + '//' + u.hostname + (u.port ? ':'+u.port : '');
    const dbName = (u.pathname && u.pathname !== '/') ? u.pathname.replace(/^\/+/, '') : undefined;
    const db = new Database({ url: baseUrl, databaseName: dbName });
    if (u.username) db.useBasicAuth(u.username, u.password);
    const colls = await db.listCollections();
    console.log('connected to', baseUrl, 'db:', dbName);
    console.log('collections count:', colls.length);
    console.log(colls.map(c=>c.name));
  } catch (e) {
    console.error('CONNECT ERROR', e.message);
    process.exit(1);
  }
})();
