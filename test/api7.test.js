/* Сигурност и довършване: строга CSP, локални шрифтове, GET без странични ефекти, двуфакторен вход, журнал, фактури по имейл. */
const assert=require('node:assert'),crypto=require('node:crypto'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');const H=require('./helpers');
const B='http://127.0.0.1:8907';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const client=()=>{let cookie='';return async(method,url,body)=>{const h={'x-fb':'1'};if(cookie)h.cookie=cookie;let b=body;if(body!==undefined){b=JSON.stringify(body);h['content-type']='application/json'}
  const r=await fetch(B+url,{method,headers:h,body:b,redirect:'manual'});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const ct=r.headers.get('content-type')||'';return{status:r.status,headers:r.headers,body:ct.includes('json')?await r.json():await r.text()}}};
const PW='parola-parola-1';
/* Независима реализация на TOTP (RFC 6238) за проверка на сървъра. */
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const dec=s=>{let bits=0,val=0;const out=[];for(const c of s.replace(/[^A-Z2-7]/g,'')){val=(val<<5)|B32.indexOf(c);bits+=5;if(bits>=8){out.push((val>>>(bits-8))&255);bits-=8}}return Buffer.from(out)};
const totp=(secret,step)=>{const m=Buffer.alloc(8);m.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',dec(secret)).update(m).digest(),o=h[h.length-1]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,'0')};
const stepNow=()=>Math.floor(Date.now()/30000);
(async()=>{
  const smtp=await H.fakeSMTP(2537);
  const srv=await H.startServer(8907,{SMTP_HOST:'127.0.0.1',SMTP_PORT:'2537',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <no-reply@finbridge.test>'});
  const db=new DatabaseSync(path.join(srv.dir,'finbridge.db'));
  try{
  const own=client(),mem=client(),off=client(),anon=client();let r;

  /* 1. CSP */
  for(const [c,u] of [[anon,'/login'],[anon,'/reset']]){r=await c('GET',u);const csp=r.headers.get('content-security-policy');
    assert(/script-src 'self';/.test(csp),'script-src без unsafe-inline: '+csp);assert(!/googleapis|gstatic/.test(csp));assert(!/<script>/.test(r.body),'няма вграден скрипт в '+u);
    for(const src of r.body.match(/\/js\/[0-9a-f]{16}\.js/g)){const j=await fetch(B+src);assert.equal(j.status,200);assert.match(j.headers.get('content-type'),/javascript/)}}
  await own('POST','/api/register',{office:'Варна Строй ООД',email:'shef@firma.test',password:PW,kind:'company'});
  await off('POST','/api/register',{office:'Счетоводна Кантора',email:'acc@office.test',password:PW});
  for(const [c,u] of [[own,'/'],[own,'/account'],[off,'/'],[off,'/account']]){r=await c('GET',u);assert.equal(r.status,200,u);assert(!/<script>/.test(r.body),'няма вграден скрипт в '+u);assert(r.body.includes('<script src="/js/'),u)}
  r=await off('GET','/');assert(!r.body.includes('fonts.googleapis'));assert(r.body.includes('/fonts/fonts.css'));
  r=await fetch(B+'/fonts/fonts.css');assert.equal(r.status,200);const css=await r.text();const woff=css.match(/\/fonts\/[\w-]+\.woff2/g);assert(woff.length>=16);
  r=await fetch(B+woff[0]);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'font/woff2');
  assert.equal((await fetch(B+'/fonts/..%2Fserver.js')).status!==200,true);assert.notEqual((await fetch(B+'/fonts/fonts.js')).status,200);
  ok('pages carry no inline script and the CSP drops unsafe-inline for scripts; fonts are served from this server, not from Google');

  /* 2. GET без странични ефекти */
  await own('PUT','/api/fin/settings',{data:{balance:0,cats:[],seller:{eik:'489280014',address:'София',mol:'Мария Петрова',iban:'BG80BNBG96611020345678'}}});
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Sofia'});
  r=await own('POST','/api/fin/recurring',{data:{party:'Абонат ООД',eik:'507081376',address:'Варна',mol:'Иван',rate:20,pay:'bank',mode:'auto',freq:'month',day:5,next:today,lines:[{name:'Поддръжка',qty:1,unit:'бр.',price:100}]}});assert.equal(r.status,200,JSON.stringify(r.body));
  const rec=r.body.id;
  const count=()=>db.prepare("SELECT COUNT(*) AS n FROM fin WHERE type = 'invoice'").get().n;
  /* създаването издава първата фактура веднага; връщаме графика назад, за да има дължими */
  const before=count();const row=db.prepare('SELECT data FROM fin WHERE id = ?').get(rec),d=JSON.parse(row.data);d.f.next=today.slice(0,8)+'01';
  if(d.f.next>today)d.f.next=today;const m0=new Date(today);m0.setMonth(m0.getMonth()-2);d.f.next=m0.toISOString().slice(0,8)+'05';db.prepare('UPDATE fin SET data = ? WHERE id = ?').run(JSON.stringify(d),rec);
  const snap=()=>JSON.stringify(db.prepare('SELECT id, status, data, updated FROM fin ORDER BY id').all());
  const s0=snap();for(let i=0;i<3;i++)assert.equal((await own('GET','/api/fin/state')).status,200);assert.equal(snap(),s0,'GET не променя базата');assert.equal(count(),before);
  assert.equal((await own('POST','/api/fin/refresh')).status,200);assert(count()>before,'POST /refresh издава дължимите фактури');
  ok('GET /api/fin/state only reads; due recurring invoices and bank matching run on POST /api/fin/refresh');

  /* 3. двуфакторен вход */
  r=await own('GET','/api/account');assert.deepEqual([r.body.email,r.body.twofa,r.body.audit],['shef@firma.test',false,true]);
  assert.equal((await own('POST','/api/2fa/enable',{code:'123456'})).status,400);
  r=await own('POST','/api/2fa/setup');const secret=r.body.secret;assert.match(secret,/^[A-Z2-7]{32}$/);assert(r.body.uri.startsWith('otpauth://totp/FinBridge%3Ashef%40firma.test?secret='+secret));
  assert.equal((await own('POST','/api/2fa/enable',{code:totp(secret,stepNow()+5)})).status,400,'грешен код');
  assert.equal((await own('POST','/api/2fa/enable',{code:totp(secret,stepNow())})).status,200);
  assert.equal((await own('GET','/api/account')).body.twofa,true);
  const c2=client();r=await c2('POST','/api/login',{email:'shef@firma.test',password:PW});assert.deepEqual([r.status,r.body.error],[401,'need_code']);assert.equal((await c2('GET','/api/fin/state')).status,401);
  r=await c2('POST','/api/login',{email:'shef@firma.test',password:'грешна-парола-1',code:totp(secret,stepNow())});assert.equal(r.body.error,'bad_login','първо се проверява паролата');
  r=await c2('POST','/api/login',{email:'shef@firma.test',password:PW,code:'000000'});assert.equal(r.body.error,'bad_code');
  /* кодът от включването вече е използван: следващата стъпка минава, а повторно същата — не */
  const nx=totp(secret,stepNow()+1);r=await c2('POST','/api/login',{email:'shef@firma.test',password:PW,code:nx});assert.equal(r.status,200);assert.equal((await c2('GET','/api/fin/state')).status,200);
  const c3=client();r=await c3('POST','/api/login',{email:'shef@firma.test',password:PW,code:nx});assert.equal(r.body.error,'bad_code','един код не се ползва два пъти');
  assert.equal((await own('POST','/api/2fa/disable',{password:PW,code:'000000'})).status,400);assert.equal((await own('POST','/api/2fa/disable',{password:'x',code:totp(secret,stepNow())})).status,400);
  assert.equal((await own('POST','/api/2fa/disable',{password:PW,code:totp(secret,stepNow())})).status,200);
  r=await client()('POST','/api/login',{email:'shef@firma.test',password:PW});assert.equal(r.status,200,'след изключване влиза само с парола');
  ok('two-factor login: setup, wrong code refused, password checked first, code required at login, a code works only once, disabling needs password and code');

  /* 4. журнал */
  await own('POST','/api/fin/users',{email:'ivan@firma.test',password:PW,role:'member',name:'Иван'});await mem('POST','/api/login',{email:'ivan@firma.test',password:PW});
  await mem('POST','/api/fin/items',{type:'expense',data:{party:'Кафе',date:today,amount:12}});
  assert.equal((await mem('GET','/api/audit')).status,403);
  r=(await own('GET','/api/audit')).body;const acts=r.map(x=>x.who+': '+x.action);
  for(const want of ['Иван: Нов финансов запис','Иван: Вход','shef@firma.test: Даден достъп на човек от фирмата','shef@firma.test: Изключен двуфакторен вход','shef@firma.test: Включен двуфакторен вход','shef@firma.test: Промяна на правилата и данните на фирмата','shef@firma.test: Нова повтаряща се фактура'])assert(acts.includes(want),'липсва '+want+' в '+acts.join(' | '));
  assert(!acts.some(a=>/refresh|scan|POST \//.test(a)),'без шум: '+acts.join(' | '));assert.equal(r[0].firm,'Варна Строй ООД');
  r=(await off('GET','/api/audit')).body;assert(r.every(x=>x.who==='acc@office.test'),'кантората вижда само своите записи');
  r=await own('GET','/api/audit?limit=2');assert.equal(r.body.length,2);const older=(await own('GET','/api/audit?limit=2&before='+r.body[1].id)).body;assert(older[0].id<r.body[1].id);
  ok('audit log records logins and changes with readable labels; owners and the office see only their own; employees cannot read it; paging works');

  /* 5. фактура по имейл */
  r=await own('POST','/api/fin/invoices',{data:{party:'Клиент ООД',eik:'507081376',address:'Варна',mol:'Иван Иванов',rate:20,pay:'bank',due:today,lines:[{name:'Консултация <b>',qty:2,unit:'час',price:100}]}});const inv=r.body;
  assert.equal((await mem('POST','/api/fin/invoices/'+inv.id+'/send',{to:'klient@example.test'})).status,403);
  assert.equal((await own('POST','/api/fin/invoices/'+inv.id+'/send',{to:'not-an-email'})).status,400);
  const sent0=smtp.mails.length;
  r=await own('POST','/api/fin/invoices/'+inv.id+'/send',{to:'Klient@Example.test',message:'Здравейте, ето фактурата.'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.mailTo,'klient@example.test');
  assert.equal(smtp.mails.length,sent0+1);const mail=smtp.mails.at(-1);assert(mail.cmds.includes('RCPT TO:<klient@example.test>'));
  const bd=/boundary="([^"]+)"/.exec(mail.body)[1];const parts=mail.body.split('--'+bd).slice(1,-1);assert.equal(parts.length,2);
  const b64=p=>Buffer.from(p.split('\n\n').slice(1).join('').replace(/\s/g,''),'base64').toString('utf8');
  const text=b64(parts[0]),att=b64(parts[1]);assert(text.startsWith('Здравейте, ето фактурата.'));assert(text.includes('Фактура № '+inv.number));assert(text.includes('IBAN: BG80BNBG96611020345678'));assert(text.includes('Сума за плащане: 200.00'),text);
  assert(/filename\*=UTF-8''%D0%A4%D0%B0%D0%BA%D1%82%D1%83%D1%80%D0%B0-\d{10}\.html/.test(parts[1]));assert(att.includes('ФАКТУРА № '+inv.number));assert(att.includes('Консултация &lt;b&gt;'),'текстът е екраниран');assert(!/<script/i.test(att));
  r=(await own('GET','/api/fin/state')).body.items.find(i=>i.id===inv.id);assert.deepEqual(r.log.at(-1).what,'sent');assert.equal(r.mailTo,'klient@example.test');
  assert((await own('GET','/api/audit')).body.some(x=>x.action==='Изпратена фактура по имейл'));
  assert.equal((await own('GET','/api/fin/state')).body.mail,true);
  ok('an issued invoice is e-mailed with a text summary and a printable attachment; the address is remembered; employees cannot send; the action is in the audit log');
  console.log('API7: all '+n+' checks passed');
  }finally{srv.stop();smtp.close();db.close()}
})().catch(e=>{console.error('API7 FAIL after step '+n+':',(e.stack||e.message||'').slice(0,1500));process.exit(1)});
