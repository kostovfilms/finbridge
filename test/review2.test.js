/* Регресии за находките с ниска тежест от независимата проверка (REVIEW.md, №16–29). */
const assert=require('node:assert'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');const H=require('./helpers');
const PW='parola-parola-1',P=9001,P2=9003;let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* Клиент с пълна кутия за бисквитки, собствен IP (x-forwarded-for) и по избор собствен Host. */
let ipn=0;const mk=(port,o)=>{o=o||{};const jar={};const ip=o.ip||'10.9.0.'+(++ipn);const f=(method,url,body,extra)=>new Promise((res,no)=>{const b=body==null?null:Buffer.isBuffer(body)?body:JSON.stringify(body);const cookie=Object.entries(jar).map(([k,v])=>k+'='+v).join('; ');
  const r=http.request({host:'127.0.0.1',port:port||P,method,path:url,headers:{'x-fb':'1','x-forwarded-for':(extra&&extra.ip)||ip,'content-type':Buffer.isBuffer(body)?'application/octet-stream':'application/json',...(o.host?{host:o.host}:{}),...(cookie?{cookie}:{}),...(b?{'content-length':Buffer.byteLength(b)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{for(const sc of x.headers['set-cookie']||[]){const [kv]=sc.split(';'),i=kv.indexOf('=');jar[kv.slice(0,i)]=kv.slice(i+1)}let j=null;try{j=JSON.parse(d)}catch(e){}res({status:x.statusCode,json:j,text:d})})});r.on('error',no);if(b)r.write(b);r.end()});f.jar=jar;return f};
const load=(file,a,b,ret)=>new Function(fs.readFileSync(path.join(__dirname,'..','public',file),'utf8').split(a)[1].split(b)[0]+';return '+ret)();
const Fin=load('company.html','/*FIN-START*/','/*FIN-END*/','Fin'),Core=load('index.html','/*CORE-START*/','/*CORE-END*/','Core');
const png=k=>Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),Buffer.alloc(k*1024,1)]);
const mailText=m=>{const b=m.body.split('\n\n').slice(1).join('').replace(/\n/g,'');try{return Buffer.from(b,'base64').toString()}catch(e){return m.body}};
const mailsTo=(smtp,addr)=>smtp.mails.filter(m=>m.cmds.includes('RCPT TO:<'+addr+'>'));
(async()=>{
  /* ---- без сървър ---- */
  /* №16: закръгляне до стотинка без грешката на плаващата запетая */
  assert.equal(Fin.invoiceTotals([{qty:14.5,price:0.01}],0).rows[0].sum,0.15);assert.equal(Fin.invoiceTotals([{qty:1,price:11.5}],9).vat,1.04);
  for(const r2 of [Fin.r2,Core.r2]){assert.equal(r2(1.005),1.01);assert.equal(r2(-0.145),-0.15);assert.equal(r2(0.1+0.2),0.3);assert.equal(r2(-0.004),0);assert(!Object.is(r2(-0.001),-0))}
  let bad=0;for(let q=1;q<=150;q++)for(let p=1;p<=2000;p++){const want=Math.floor((q*p*2+100)/200)/100;/* q/100 × p/100, половината нагоре, в цели числа */if(Fin.invoiceTotals([{qty:q/100,price:p/100}],0).rows[0].sum!==want)bad++}assert.equal(bad,0,'грешни стойности на ред: '+bad);
  bad=0;for(let c=1;c<=300000;c+=7){for(const rate of [9,20]){const want=Math.floor((c*rate*2+100)/200)/100;if(Fin.invoiceTotals([{qty:1,price:c/100}],rate).vat!==want)bad++}}assert.equal(bad,0,'грешно ДДС: '+bad);
  ok('#16 line values and VAT round to the cent exactly (0,01 × 14,50 = 0,15; 9% of 11,50 = 1,04) across 300 000 samples');
  /* №27: дати и двусмислени суми в извлечения */
  assert.equal(Core.parseDate('31.02.2026'),null);assert.equal(Core.parseDate('30.02.2026'),null);assert.equal(Core.parseDate('29.02.2026'),null);assert.equal(Core.parseDate('29.02.2024'),'2024-02-29');assert.equal(Core.parseDate('2026-04-31'),null);assert.equal(Core.parseDate('31.12.2026'),'2026-12-31');
  assert.equal(Core.ambAmount('1.234'),true);assert.equal(Core.ambAmount('-1,234'),true);assert.equal(Core.ambAmount('12.50'),false);assert.equal(Core.ambAmount('1 234,00'),false);
  const csv='Дата;Сума;Контрагент;Описание\n01.11.2026;-1.234;Доставчик ООД;фактура 1\n02.11.2026;-12,50;Друг ЕООД;фактура 2\n31.02.2026;-5,00;Грешна дата;x\n';
  const ps=Core.parseStatement(csv);assert(ps&&ps.txs.length===2,JSON.stringify(ps));assert.equal(ps.ambiguous,1);assert.equal(ps.skipped,1);
  ok('#27 statement dates must exist (31.02 is skipped) and an amount like 1.234 is flagged for review before import');
  /* №29: ЕИК, ЕГН, ЛНЧ и ДДС номер */
  for(const e of ['0000000000','000000000','0000000000000'])assert.equal(Core.eikValid(e),false,e);assert.equal(Core.eikValid('8001010008'),true);assert.equal(Core.eikValid('8013010008'),false,'13-и месец');
  assert.equal(Fin.idValid('489280014'),true);assert.equal(Fin.idValid('489280011'),false);assert.equal(Fin.idValid('0000000000'),false);assert.equal(Fin.idValid('8001010008'),true);
  assert.equal(Fin.vatNoValid('BG489280014'),true);assert.equal(Fin.vatNoValid('BG489280011'),false);assert.equal(Fin.vatNoValid('DE123456789'),true);assert.equal(Fin.vatNoValid('XX12'),false);
  assert.deepEqual(Fin.idWarnings('489280014','BG489280014'),[]);assert.equal(Fin.idWarnings('0000000000','').length,1);assert(Fin.idWarnings('489280014','BG507081376')[0].includes('не съвпада'));
  ok('#29 EIK, EGN and LNCh are checked by their control digit and the VAT number by format; all zeros is never valid');
  /* №23: ден 31 значи последния ден от месеца */
  assert.equal(Fin.addMonths('2026-01-31',1,31),'2026-02-28');assert.equal(Fin.addMonths('2026-02-28',1,31),'2026-03-31');assert.equal(Fin.addMonths('2026-03-31',1,31),'2026-04-30');assert.equal(Fin.addMonths('2027-12-31',2,31),'2028-02-29');assert.equal(Fin.addMonths('2026-01-15',1,15),'2026-02-15');
  ok('#23 day 31 in a schedule means the last day of each month (28.02, 31.03, 30.04, 29.02 in a leap year)');
  /* №25, №28: проверки по кода */
  const idx=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');assert.equal((idx.match(/(?:data-id|value)="' \+ (?:d|f|rp|t|u|x|S)\.(?:id|docId|period) \+ '/g)||[]).length,0,'неекранирани идентификатори');assert(!idx.includes("(l.qty == null ? '' : l.qty)"));
  const lg=fs.readFileSync(path.join(__dirname,'..','public','login.html'),'utf8');assert(/id="code"[^>]*inputmode="text"/.test(lg)&&/id="code"[^>]*autocapitalize="off"/.test(lg));
  ok('#25 #28 stored ids and quantities go through esc(); the sign-in code field opens a text keyboard for recovery codes');

  /* ---- основен сървър ---- */
  const smtp=await H.fakeSMTP(9002);
  const S=await H.startServer(P,{TRUST_PROXY:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:'9002',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <noreply@finbridge.test>',BASE_URL:'http://127.0.0.1:'+P,REMIND_INTERVAL_MS:'999999999',OFFICE_QUOTA_MB:'2',PORTAL_QUOTA_MB:'0.3'});
  let S2=null,smtp2=null;
  try{
  /* №17: таван за необработените файлове от портала на една фирма */
  const K=mk();await K('POST','/api/register',{office:'Кантора Квота',email:'k@q.test',password:PW,kind:'office'});
  for(const id of ['g1','g2'])assert.equal((await K('PUT','/api/firms/'+id,{data:{name:'Фирма '+id,address:id+'@q.test'}})).status,200);
  const tok=(await K('GET','/api/firms')).json.find(f=>f.id==='g1').portal.split('/u/')[1],pub=mk();
  const up=()=>pub('POST','/u/'+tok+'/upload?name=f.png',png(100));
  for(let i=0;i<3;i++)assert.equal((await up()).status,200,'качване '+i);
  let r=await up();assert.equal(r.status,413);assert(r.json.message.includes('необработени'),r.text);
  r=await K('POST','/api/files?firm=g2&name=b.png',png(500));assert.equal(r.status,200,'счетоводителят качва за друга фирма: '+r.text);
  const fid=(await K('GET','/api/inbox')).json.find(x=>x.firm==='g1').id;assert.equal((await K('POST','/api/files/'+fid+'/done')).status,200);assert.equal((await up()).status,200,'след преглед порталът пак приема');
  ok('#17 the portal of one firm can fill only its own share of unprocessed files; the accountant and the other firms keep working');
  /* №26: име на фирма с $' и {{CARDS}} не разваля портала */
  const nm="Фирма $' $` $& {{CARDS}} {{NONCE}}";assert.equal((await K('PUT','/api/firms/g3',{data:{name:nm,address:'g3@q.test'}})).status,200);
  const t3=(await K('GET','/api/firms')).json.find(f=>f.id==='g3').portal.split('/u/')[1];r=await pub('GET','/u/'+t3);assert.equal(r.status,200);
  const h1=/<h1>([\s\S]*?)<\/h1>/.exec(r.text)[1];assert.equal(h1,'Документи за '+nm.replace(/&/g,'&amp;').replace(/'/g,'&#39;'));assert(r.text.includes('id="upload"'),'разделът за качване');assert.equal((r.text.match(/<h1>/g)||[]).length,1);
  ok('#26 a firm name with $\', $` or {{CARDS}} shows as plain text and the portal keeps its upload section');
  /* №18: само неуспешните опити заключват, и не браузъра, от който вече е влизано */
  const V=mk();await V('POST','/api/register',{office:'Жертва',email:'v@q.test',password:PW,kind:'office'});
  const known=mk();assert.equal((await known('POST','/api/login',{email:'v@q.test',password:PW})).status,200);assert(known.jar.fb_k,'знак за познат браузър');
  for(let i=0;i<35;i++)assert.equal((await mk()('POST','/api/login',{email:'v@q.test',password:PW})).status,200,'успешен вход '+i);
  ok('#18 successful sign-ins are not counted toward the account lock');
  const n0=mailsTo(smtp,'v@q.test').length;for(let i=0;i<30;i++)assert.equal((await mk()('POST','/api/login',{email:'v@q.test',password:'gresna-parola-'+i})).status,401,'опит '+i);
  assert.equal((await mk()('POST','/api/login',{email:'v@q.test',password:PW})).status,429,'нов браузър е спрян');
  assert.equal((await known('POST','/api/login',{email:'v@q.test',password:PW})).status,200,'познатият браузър влиза');
  await sleep(300);const lockMail=mailsTo(smtp,'v@q.test').slice(n0);assert.equal(lockMail.length,1);assert(mailText(lockMail[0]).includes('неуспешни опити'));
  ok('#18 after 30 wrong passwords new browsers wait, the owner still signs in from a known browser and gets one e-mail about it');
  /* №21: връщането по кредитно известие се преизчислява, когато фактурата се върне в „неплатена“ */
  const own=mk();await own('POST','/api/register',{office:'Продавач',email:'own@q.test',password:PW,kind:'company'});
  assert.equal((await own('PUT','/api/fin/settings',{data:{balance:0,cats:['Други'],seller:{name:'Продавач ООД',eik:'489280014',address:'София',mol:'М'}}})).status,200);
  const iss=price=>own('POST','/api/fin/invoices',{data:{party:'Клиент',eik:'507081376',rate:0,vatNote:'чл. 113',lines:[{name:'Услуга',qty:1,price}]}}).then(x=>x.json);
  const st=(id,s)=>own('POST','/api/fin/items/'+id+'/status',{status:s}),cn=(id,price)=>own('POST','/api/fin/invoices/'+id+'/credit',{data:{reason:'отстъпка',lines:[{name:'Отстъпка',qty:1,price}]}});
  const item=async id=>(await own('GET','/api/fin/state')).json.items.find(i=>i.id===id);
  let a=await iss(100);assert.equal((await st(a.id,'paid')).status,200);r=await cn(a.id,60);assert.equal(r.status,200,r.text);const c1=r.json.credit;assert.deepEqual([c1.refund,c1.status],[60,'open']);
  assert.equal((await st(a.id,'open')).status,200);let c=await item(c1.id);assert.deepEqual([c.refund,c.status],[0,'issued'],'нищо не е платено, нищо не се връща');
  a=await iss(100);for(const x of [60,30])assert.equal((await own('POST','/api/fin/items/'+a.id+'/pay',{amount:x})).status,200);r=await cn(a.id,50);const c2=r.json.credit;assert.deepEqual([c2.refund,r.json.invoice.status],[40,'paid'],'платени 90 при дължими 50');
  assert.equal((await st(a.id,'open')).status,200);c=await item(c2.id);assert.deepEqual([c.refund,c.status],[10,'open'],'последната вноска (30) отпада, остават 60 при дължими 50');
  a=await iss(100);assert.equal((await st(a.id,'paid')).status,200);const c3=(await cn(a.id,40)).json.credit;assert.equal((await st(c3.id,'paid')).status,200);
  r=await st(a.id,'open');assert.equal(r.status,409);assert.equal(r.json.error,'refunded');
  ok('#21 reopening an invoice recalculates the refund of its credit notes from what was really paid, and is refused once the money went back');
  /* №22: без допуск от 1 стотинка */
  a=await iss(0.05);r=await cn(a.id,0.06);assert.equal(r.status,400);assert.equal(r.json.error,'too_much');assert.equal((await cn(a.id,0.05)).status,200);
  a=await iss(10);r=await own('POST','/api/fin/items/'+a.id+'/pay',{amount:10.01});assert.equal(r.status,400);
  ok('#22 a credit note or a payment cannot exceed what is left by even one cent');
  /* №23: ден 31 се пази, а редакция на шаблон на пауза не го подновява */
  const today=(await own('GET','/api/fin/state')).json.today;
  r=await own('POST','/api/fin/recurring',{data:{party:'Абонат',eik:'507081376',rate:0,vatNote:'чл. 113',lines:[{name:'Абонамент',qty:1,price:10}],freq:'month',day:31,next:Fin.addMonths(today,1,31),mode:'confirm',dueDays:7}});assert.equal(r.status,200,r.text);
  const rid=r.json.id;assert.equal(r.json.day,31);
  assert.equal((await own('POST','/api/fin/recurring/'+rid+'/pause',{paused:true})).json.status,'paused');
  r=await own('PUT','/api/fin/recurring/'+rid,{data:{party:'Абонат',eik:'507081376',rate:0,vatNote:'чл. 113',lines:[{name:'Абонамент',qty:1,price:12}],freq:'month',day:31,next:Fin.addMonths(today,1,31),mode:'confirm',dueDays:7}});
  assert.equal(r.status,200,r.text);assert.deepEqual([r.json.status,r.json.amount],['paused',12]);
  ok('#23 a schedule on day 31 is kept as the last day of the month, and editing a paused template leaves it paused');
  /* №24: по-висок таван за месец и ясно съобщение */
  const tx=i=>({id:'t'+i,date:'2026-11-03',amount:-10,cp:'Доставчик '+i,desc:'Плащане по фактура '+'x'.repeat(220),needsDoc:true});
  r=await K('PUT','/api/period/g1/2026-11',{data:{txs:Array.from({length:12000},(_,i)=>tx(i)),docs:[]}});assert.equal(r.status,200,'около 3,5 MB: '+r.status);
  r=await K('PUT','/api/period/g2/2026-11',{data:{txs:Array.from({length:30000},(_,i)=>tx(i)),docs:[]}});assert.equal(r.status,413);assert.equal(r.json.error,'period_too_large');assert(r.json.message.includes('8 MB'));
  ok('#24 a month of 12 000 payments is saved; one over the 8 MB cap gets a clear message instead of a generic failure');

  /* ---- сървър без BASE_URL и с включено потвърждение на имейла ---- */
  smtp2=await H.fakeSMTP(9004);
  S2=await H.startServer(P2,{TRUST_PROXY:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:'9004',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <noreply@finbridge.test>',BASE_URL:'',RENDER_EXTERNAL_URL:'',EMAIL_VERIFY:'true',REMIND_INTERVAL_MS:'999999999'});
  /* №20 */
  const U=mk(P2);r=await U('POST','/api/register',{office:'Нова кантора',email:'nova@q.test',password:PW,kind:'office'});assert.equal(r.status,200,r.text);
  assert.equal((await U('GET','/api/me')).json.verified,false);await sleep(300);
  const vm=mailsTo(smtp2,'nova@q.test');assert.equal(vm.length,1);const vtok=/\/verify#([A-Za-z0-9_-]+)/.exec(mailText(vm[0]))[1];
  assert.equal((await U('PUT','/api/firms/c1',{data:{name:'Клиент',address:'client@q.test'}})).status,200);
  r=await U('POST','/api/email',{firm:'c1',text:'Здравейте'});assert.equal(r.status,403);assert.equal(r.json.error,'unverified');
  assert.equal((await U('POST','/api/users',{email:'kolega@q.test',password:PW})).status,200);assert.equal((await U('POST','/api/email',{firm:'c1',text:'Здравейте'})).status,403,'добавеният колега не потвърждава кантората');
  assert.equal((await mk(P2)('POST','/api/verify',{token:'x'+vtok})).status,400);assert.equal((await mk(P2)('POST','/api/verify',{token:vtok})).status,200);
  assert.equal((await U('GET','/api/me')).json.verified,true);r=await U('POST','/api/email',{firm:'c1',text:'Здравейте'});assert.equal(r.status,200,r.text);
  assert.equal((await mk(P2)('GET','/verify')).status,200);
  const W=mk(P2);await W('POST','/api/register',{office:'Втора',email:'vtora@q.test',password:PW,kind:'company'});await sleep(200);assert.equal((await W('POST','/api/verify/resend')).status,200);await sleep(300);assert.equal(mailsTo(smtp2,'vtora@q.test').length,2);
  await mk(P2)('POST','/api/forgot',{email:'vtora@q.test'});await sleep(300);const rtok=/\/reset#([A-Za-z0-9_-]+)/.exec(mailText(mailsTo(smtp2,'vtora@q.test').pop()))[1];
  assert.equal((await mk(P2)('POST','/api/reset',{token:rtok,password:PW+'x'})).status,200);const W2=mk(P2);await W2('POST','/api/login',{email:'vtora@q.test',password:PW+'x'});assert.equal((await W2('GET','/api/me')).json.verified,true,'връзката за нова парола доказва и адреса');
  ok('#20 a new account confirms its e-mail before the office sends mail to clients; a link for a new password confirms it too');
  /* №19: без BASE_URL отговорът не издава дали имейлът е регистриран */
  const pubHost=()=>mk(P2,{host:'finbridge.example.com'});
  const known19=await pubHost()('POST','/api/forgot',{email:'nova@q.test'}),unknown19=await pubHost()('POST','/api/forgot',{email:'nikoj@q.test'});
  assert.equal(known19.status,unknown19.status);assert.equal(known19.text,unknown19.text);
  const db=new (require('node:sqlite').DatabaseSync)(path.join(S2.dir,'finbridge.db'));assert.equal(db.prepare("SELECT COUNT(*) n FROM resets r JOIN users u ON u.id = r.user_id WHERE u.email = 'nova@q.test'").get().n,0,'без връзка не се пази жетон');db.close();
  ok('#19 without BASE_URL "forgot password" answers the same for a known and an unknown address and stores no token');
  console.log('\n'+n+' passed');
  }catch(e){console.error('REVIEW2 FAIL after step '+n+':',e);process.exitCode=1}
  finally{S.stop();if(S2)S2.stop();smtp.close();if(smtp2)smtp2.close();setTimeout(()=>process.exit(),200)}
})();
