/* Роли в кантората (собственик, счетоводител) и покани с връзка вместо парола, зададена от колега. */
const assert=require('node:assert'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{DatabaseSync}=require('node:sqlite');const H=require('./helpers');
const PW='parola-parola-1',P=9051;let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const tok=link=>/\/invite#([A-Za-z0-9_-]+)$/.exec(link)[1];
(async()=>{
  const smtp=await H.fakeSMTP(9052),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fb-inv-'));
  const env={DATA_DIR:dir,SMTP_HOST:'127.0.0.1',SMTP_PORT:'9052',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <noreply@finbridge.test>',BASE_URL:'http://127.0.0.1:'+P,REMIND_INTERVAL_MS:'999999999'};
  let srv=await H.startServer(P,env);
  try{
  const A=H.client(P);await A('POST','/api/register',{office:'Кантора Покана',email:'a@a.test',password:PW});assert.equal((await A('GET','/api/me')).json.role,'owner');
  await A('PUT','/api/firms/f1',{data:{name:'Клиент 1'}});
  let r=await A('POST','/api/users',{email:'K@a.test'});assert.equal(r.status,200,r.text);assert(r.json.mailed);const link=r.json.link;assert(link.startsWith('http://127.0.0.1:'+P+'/invite#'));
  await H.sleep(300);const m=smtp.mails.filter(x=>x.cmds.includes('RCPT TO:<k@a.test>')).map(H.mailText).pop();assert(m&&m.includes(link)&&m.includes('Кантора Покана')&&m.includes('счетоводител'),String(m));
  assert.deepEqual((await A('GET','/api/invites')).json.map(i=>[i.email,i.role]),[['k@a.test','accountant']]);
  ok('the owner invites a colleague without choosing a password; the letter carries a 7-day link');

  const K=H.client(P);r=await K('POST','/api/invite/info',{token:tok(link)});assert.deepEqual([r.json.email,r.json.where,r.json.role],['k@a.test','Кантора Покана','accountant']);
  assert.equal((await K('POST','/api/invite/accept',{token:tok(link),password:'kratka'})).status,400);
  r=await K('POST','/api/invite/accept',{token:tok(link),password:PW,name:'Колега'});assert.equal(r.status,200);const me=(await K('GET','/api/me')).json;assert.deepEqual([me.role,me.verified],['accountant',true]);
  assert.equal((await H.client(P)('POST','/api/invite/accept',{token:tok(link),password:PW})).status,400,'връзката важи веднъж');assert.deepEqual((await A('GET','/api/invites')).json,[]);
  ok('the colleague sets their own password from the link, is signed in and confirmed; the link works only once');

  for(const [mth,u,b] of [['POST','/api/users',{email:'z@a.test'}],['DELETE','/api/firms/f1'],['GET','/api/audit'],['GET','/api/backup'],['GET','/api/invites']])assert.equal((await K(mth,u,b)).status,403,mth+' '+u);
  for(const [mth,u,b] of [['GET','/api/firms'],['PUT','/api/firms/f2',{data:{name:'Клиент 2'}}],['GET','/api/users']])assert.equal((await K(mth,u,b)).status,200,mth+' '+u);
  ok('an accountant works with the firms but cannot invite, delete firms, or read the log and the backup');

  const users=(await A('GET','/api/users')).json,kid=users.find(u=>u.email==='k@a.test').id,aid=users.find(u=>u.me).id;
  assert.equal((await A('PUT','/api/users/'+kid,{role:'owner'})).status,200);assert.equal((await K('GET','/api/me')).json.role,'owner');
  assert.equal((await A('PUT','/api/users/'+aid,{role:'accountant'})).status,200,'има друг собственик');
  r=await K('PUT','/api/users/'+kid,{role:'accountant'});assert.equal(r.json.error,'last_owner');
  ok('roles can be changed, but the office always keeps at least one owner');

  r=await K('POST','/api/users',{email:'x@a.test',role:'owner'});const xid=(await K('GET','/api/invites')).json[0].id;assert.equal((await K('DELETE','/api/invites/'+xid)).status,200);
  assert.equal((await H.client(P)('POST','/api/invite/info',{token:tok(r.json.link)})).status,400);
  assert.equal((await K('POST','/api/users',{email:'a@a.test'})).status,409);
  ok('a cancelled invite no longer opens; an address that already has an account cannot be invited');

  /* фирма */
  const C=H.client(P);await C('POST','/api/register',{office:'Фирма Покана ЕООД',email:'c@c.test',password:PW,kind:'company'});
  r=await C('POST','/api/fin/users',{email:'m@c.test',role:'member',name:'Мария'});assert.equal(r.status,200,r.text);
  assert.deepEqual((await C('GET','/api/fin/invites')).json.map(i=>[i.email,i.role,i.name]),[['m@c.test','member','Мария']]);
  const M=H.client(P);assert.equal((await M('POST','/api/invite/accept',{token:tok(r.json.link),password:PW})).status,200);
  const st=(await M('GET','/api/fin/state')).json;assert.deepEqual([st.me.role,st.me.name,st.firm.name],['member','Мария','Фирма Покана ЕООД']);
  assert.equal((await M('GET','/api/fin/invites')).status,403);
  ok('a company owner invites an employee the same way; the role and name come from the invite');

  /* кантора от по-стара версия без собственик */
  srv.stop();await H.sleep(400);
  {const db=new DatabaseSync(path.join(dir,'finbridge.db'),{timeout:5000});const o=db.prepare("SELECT office_id AS o FROM users WHERE email='a@a.test'").get().o;db.prepare("UPDATE users SET crole='' WHERE office_id=? AND firm_id=''").run(o);db.close()}
  srv=await H.startServer(P,env);
  const A2=H.client(P);await A2('POST','/api/login',{email:'a@a.test',password:PW});assert.equal((await A2('GET','/api/me')).json.role,'owner','най-старият става собственик');
  const K2=H.client(P);await K2('POST','/api/login',{email:'k@a.test',password:PW});assert.equal((await K2('GET','/api/me')).json.role,'accountant');
  ok('an office from an older version gets its earliest user as owner on start-up');
  console.log('Invites: all '+n+' checks passed');
  }finally{srv.stop();smtp.close()}
})().catch(e=>{console.error('Invites FAIL after check '+n+':',e);process.exit(1)});
