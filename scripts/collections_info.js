import dotenv from 'dotenv'; dotenv.config();
import { Database } from 'arangojs';
(async ()=>{ try{
  const u=new URL(process.env.ARANGO_URL); const base=u.protocol+'//'+u.hostname+(u.port?':'+u.port:''); const dbName=(u.pathname && u.pathname!='/')?u.pathname.replace(/^\/+/, ''):undefined; const db=new Database({url:base,databaseName:dbName}); if(u.username) db.useBasicAuth(u.username,u.password);
  const names=['documents','sections','edges'];
  for(const n of names){ const c=db.collection(n); const exists=await c.exists(); console.log(n,'exists',exists); const props=await c.get(); console.log(n,'props',props.type, props.id, props.name); }
 } catch(e){ console.error('ERR', e); process.exit(1);} })();