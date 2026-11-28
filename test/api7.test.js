/* Двуфакторен вход, журнал на действията, задължителен 2FA. */
const assert=require('node:assert'),http=require('node:http'),crypto=require('node:crypto'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');const H=require('./helpers');
const PW='parola-parola-1';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const mk=port=>{let cookie='';const f=async(method,url,body,ip)=>{const b=body==null?null:JSON.stringify(body);return new Promise((res,no)=>{const r=http.request({host:'127.0.0.1',port,method,path:url,headers:{'x-fb':'1','content-type':'application/json','x-forwarded-for':ip||'10.1.1.1',...(cookie?{cookie}:{}),...(b?{'content-length':Buffer.byteLength(b)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{const sc=x.headers['set-cookie'];if(sc)cookie=sc[0].split(';')[0];let j=null;try{j=JSON.parse(d)}catch(e){}res({status:x.statusCode,json:j,text:d,headers:x.headers})})});r.on('error',no);if(b)r.write(b);r.end()})};f.drop=()=>{cookie=''};return f};
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const dec=s=>{let bits='';for(const c of s)bits+=B32.indexOf(c).toString(2).padStart(5,'0');const o=[];for(let i=0;i+8<=bits.length;i+=8)o.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(o)};
const totp=(secret,step)=>{const c=Buffer.alloc(8);c.writeBigUInt64BE(BigInt(step==null?Math.floor(Date.now()/30000):step));const h=crypto.createHmac('sha1',dec(secret)).update(c).digest(),o=h[19]&15;return String(((h[o]&127)<<24|h[o+1]<<16|h[o+2]<<8|h[o+3])%1e6).padStart(6,'0')};
(async()=>{
  /* RFC 6238, приложение B: ключ "12345678901234567890", SHA-1 */
  const rfc='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';assert.equal(totp(rfc,Math.floor(59/30)),'287082');assert.equal(totp(rfc,Math.floor(1111111109/30)),'081804');assert.equal(totp(rfc,Math.floor(2000000000/30)),'279037');ok('test TOTP generator matches RFC 6238 vectors');
  const S=await H.startServer(8951,{TRUST_PROXY:'true'});const S2=await H.startServer(8952,{TRUST_PROXY:'true',REQUIRE_2FA:'true'});
  try{
  const A=mk(8951);await A('POST','/api/register',{office:'Фирма А',email:'a@a.test',password:PW,kind:'company'});
  const OLD=mk(8951);await OLD('POST','/api/login',{email:'a@a.test',password:PW});let r=await OLD('GET','/api/me');assert.equal(r.status,200);r=await A('GET','/api/2fa');assert.deepEqual([r.json.enabled,r.json.required,r.json.log],[false,false,true]);
  r=await A('POST','/api/2fa/setup',{password:'greshna-parola'});assert.equal(r.status,400);
  r=await A('POST','/api/2fa/setup',{password:PW});assert.equal(r.status,200);const secret=r.json.secret;assert(/^[A-Z2-7]{32}$/.test(secret));assert(r.json.uri.startsWith('otpauth://totp/FinBridge%3Aa%40a.test?secret='+secret));
  r=await A('POST','/api/2fa/enable',{code:'000000'});assert.equal(r.status,400);assert.equal((await A('GET','/api/2fa')).json.enabled,false);
  r=await A('POST','/api/2fa/enable',{code:totp(secret)});assert.equal(r.status,200);const rec=r.json.recovery;assert.equal(rec.length,8);assert(rec.every(c=>/^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)));assert.equal(new Set(rec).size,8);
  r=await A('GET','/api/2fa');assert.deepEqual([r.json.enabled,r.json.recoveryLeft],[true,8]);ok('setup needs the password, a wrong code does not enable, a right one returns 8 recovery codes');
  const db=new DatabaseSync(path.join(S.dir,'finbridge.db'));const row=db.prepare("SELECT totp, recovery FROM users WHERE email='a@a.test'").get();for(const c of rec)assert(!row.recovery.includes(c)&&!row.recovery.includes(c.replace('-','')));assert.equal(JSON.parse(row.recovery).length,8);ok('recovery codes are stored only as hashes');
  const L=mk(8951);r=await L('POST','/api/login',{email:'a@a.test',password:'greshna-parola-9'});assert.equal(r.json.error,'bad_login');
  r=await L('POST','/api/login',{email:'a@a.test',password:'greshna-parola-9',code:totp(secret)});assert.equal(r.json.error,'bad_login','без вярна парола не се издава дали има 2FA');
  r=await L('POST','/api/login',{email:'a@a.test',password:PW});assert.equal(r.status,401);assert.equal(r.json.error,'totp_required');assert.equal((await L('GET','/api/me')).status,401);
  r=await L('POST','/api/login',{email:'a@a.test',password:PW,code:'123456'});assert.equal(r.json.error,'bad_code');
  /* кодът от включването вече е използван: стъпката му не важи втори път */
  const now=Math.floor(Date.now()/30000);r=await L('POST','/api/login',{email:'a@a.test',password:PW,code:totp(secret,now)});const usedNow=r.status===200;
  if(!usedNow){assert.equal(r.json.error,'bad_code');r=await L('POST','/api/login',{email:'a@a.test',password:PW,code:totp(secret,now+1)});assert.equal(r.status,200,r.text)}
  assert.equal((await L('GET','/api/me')).status,200);const L2=mk(8951);r=await L2('POST','/api/login',{email:'a@a.test',password:PW,code:totp(secret,usedNow?now:now+1)});assert.equal(r.json.error,'bad_code','един код не важи два пъти');ok('login: password first, then code; wrong and replayed codes are refused');
  r=await L2('POST','/api/login',{email:'a@a.test',password:PW,code:rec[0].toUpperCase()});assert.equal(r.status,200,r.text);L2.drop();r=await L2('POST','/api/login',{email:'a@a.test',password:PW,code:rec[0]});assert.equal(r.json.error,'bad_code');assert.equal((await OLD('GET','/api/me')).status,401,'другите сесии са прекратени при включване');assert.equal((await A('GET','/api/2fa')).status,200);
  assert.equal((await L('GET','/api/2fa')).json.recoveryLeft,7);ok('a recovery code works once; enabling 2FA ends other sessions');
  let last;for(let i=0;i<12;i++)last=await L2('POST','/api/login',{email:'a@a.test',password:PW,code:String(100000+i)},'10.1.2.'+i);assert.equal(last.status,429);ok('code guessing is rate limited per account, across addresses');
  r=await L('POST','/api/2fa/disable',{password:PW,code:'000000'});assert.equal(r.status,400);r=await L('POST','/api/2fa/disable',{password:'greshna-parola',code:rec[1]});assert.equal(r.status,400);assert.equal((await L('GET','/api/2fa')).json.recoveryLeft,7);
  r=await L('POST','/api/2fa/disable',{password:PW,code:rec[1]});assert.equal(r.status,200);const L3=mk(8951);assert.equal((await L3('POST','/api/login',{email:'a@a.test',password:PW},'10.3.3.3')).status,200);ok('disabling needs password and a valid code; afterwards login works without a code');

  /* журнал */
  await L('PUT','/api/fin/settings',{data:{balance:5,cats:['Гориво'],seller:{eik:'489280014',address:'София',mol:'М'}}});
  const inv=(await L('POST','/api/fin/invoices',{data:{party:'Клиент <b>ООД</b>',eik:'507081376',rate:0,vatNote:'чл. 113',lines:[{name:'x',qty:1,price:100}]}})).json;assert(inv.id);
  await L('POST','/api/fin/items/'+inv.id+'/pay',{amount:40});await L('POST','/api/fin/users',{email:'m@a.test',password:PW,role:'member',name:'Служител'});await L('GET','/api/fin/export?kind=ledger&period=2026-11');
  await L('POST','/api/fin/items',{type:'expense',data:{party:'x',date:'bad',amount:'x'}});
  r=await L('GET','/api/audit');assert.equal(r.status,200);const acts=r.json.rows.map(x=>x.action);
  for(const a of ['Регистрация','Включен двуфакторен вход','Вход','Неуспешен вход','Изключен двуфакторен вход','Променени правила и данни на фирмата','Издадена фактура','Отбелязано плащане','Добавен потребител'])assert(acts.includes(a),'липсва: '+a+' в '+acts.join(' | '));
  const iv=r.json.rows.find(x=>x.action==='Издадена фактура');assert(iv.detail.includes('№ '+inv.number)&&iv.detail.includes('Клиент <b>ООД</b>'));assert.equal(iv.email,'a@a.test');assert(/^10\./.test(iv.ip));assert(r.json.rows.some(x=>x.action==='Вход'&&x.detail==='с резервен код'));
  assert(!acts.includes('Нов запис'),'отхвърлена заявка не се записва като действие');assert(!JSON.stringify(r.json).includes(PW)&&!JSON.stringify(r.json).includes(secret));for(let i=1;i<r.json.rows.length;i++)assert(r.json.rows[i].id<r.json.rows[i-1].id);ok('the log records sign-ins, 2FA changes, invoices, payments and team changes, newest first, without secrets');
  const M=mk(8951);await M('POST','/api/login',{email:'m@a.test',password:PW},'10.4.4.4');assert.equal((await M('GET','/api/audit')).status,403);
  const B=mk(8951);await B('POST','/api/register',{office:'Фирма Б',email:'b@b.test',password:PW,kind:'company'},'10.5.5.5');r=await B('GET','/api/audit');assert.deepEqual(r.json.rows.map(x=>x.action),['Регистрация']);
  for(const [m,u] of [['DELETE','/api/audit'],['PUT','/api/audit'],['POST','/api/audit'],['DELETE','/api/audit/1']])assert([403,404].includes((await L(m,u,{})).status),m+' '+u);assert(db.prepare('SELECT COUNT(*) n FROM audit').get().n>=10);db.close();ok('only the owner reads the log, other companies see only their own, and there is no way to edit or delete it');
  const K=mk(8951);await K('POST','/api/register',{office:'Кантора',email:'k@k.test',password:PW,kind:'office'},'10.6.6.6');await K('PUT','/api/firms/f1',{data:{name:'Клиент 1'}});await K('PUT','/api/period/f1/2026-11',{data:{txs:[],docs:[]}});await K('PUT','/api/period/f1/2026-11',{data:{txs:[],docs:[]}});await K('GET','/api/backup');
  r=await K('GET','/api/audit');const ka=r.json.rows.map(x=>x.action);assert(ka.includes('Фирма: запис')&&ka.includes('Изтеглен архив на данните'));assert.equal(ka.filter(x=>x==='Запис на период').length,1,'автоматичните записи не заливат журнала');assert.equal(r.json.rows.find(x=>x.action==='Фирма: запис').firm,'f1');ok('accountant office: firm changes and backups are logged, autosaves are collapsed');

  /* страница и задължителен 2FA */
  r=await K('GET','/security');assert.equal(r.status,200);assert(/nonce-/.test(r.headers['content-security-policy']));assert.equal((await mk(8951)('GET','/security')).status,302);
  const R=mk(8952);await R('POST','/api/register',{office:'Строга фирма',email:'r@r.test',password:PW,kind:'company'});
  r=await R('GET','/api/fin/state');assert.equal(r.status,403);assert.equal(r.json.error,'need_2fa');r=await R('GET','/');assert.equal(r.status,302);assert.equal(r.headers.location,'/security');assert.equal((await R('GET','/api/me')).status,200);assert.equal((await R('GET','/api/2fa')).json.required,true);
  const s2=(await R('POST','/api/2fa/setup',{password:PW})).json.secret;assert.equal((await R('POST','/api/2fa/enable',{code:totp(s2)})).status,200);assert.equal((await R('GET','/api/fin/state')).status,200);assert.equal((await R('GET','/')).status,200);ok('with REQUIRE_2FA owners are sent to the security page until they enable it');
  console.log('\n'+n+' passed');
  }finally{S.stop();S2.stop()}
})().catch(e=>{console.error('API7 FAIL after step '+n+':',e.message);process.exit(1)});
