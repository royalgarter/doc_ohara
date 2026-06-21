import dotenv from 'dotenv'; dotenv.config();
import { Database } from 'arangojs';
(async ()=>{
  try{
    const u=new URL(process.env.ARANGO_URL);
    const base=u.protocol+'//'+u.hostname+(u.port?':'+u.port:'');
    const dbName=(u.pathname && u.pathname!='/')?u.pathname.replace(/^\/+/, ''):undefined;
    const db=new Database({url:base,databaseName:dbName});
    if(u.username) db.useBasicAuth(u.username,u.password);

    const cur = await db.query("FOR c IN COLLECTIONS() FILTER STARTS_WITH(c.name, @p) RETURN c.name", { p: 'edges_old_' });
    const rows = await cur.all();
    if(!rows || rows.length===0){
      console.log('No edges_old_* collections found.');
      return;
    }
    console.log('Found collections to drop:', rows);
    for(const name of rows){
      try{
        console.log('Dropping', name);
        await db.collection(name).drop();
        console.log('Dropped', name);
      } catch(e){
        console.error('Failed to drop', name, e.message);
      }
    }
    console.log('Done.');
  } catch(e){
    console.error('ERR', e.message);
    process.exit(1);
  }
})();
