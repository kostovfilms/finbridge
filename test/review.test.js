/* Регресии за находките от независимата проверка (REVIEW.md). Номерата са от доклада. */
const assert=require('node:assert'),http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');const H=require('./helpers');
const PW='parola-parola-1',P=8981;let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
let ipn=0;const mk=()=>{let cookie='';const ip='10.8.0.'+(++ipn);const f=(method,url,body)=>new Promise((res,no)=>{const b=body==null?null:Buffer.isBuffer(body)?body:JSON.stringify(body);const r=http.request({host:'127.0.0.1',port:P,method,path:url,headers:{'x-fb':'1','x-forwarded-for':ip,'content-type':'application/json',...(cookie?{cookie}:{}),...(b?{'content-length':Buffer.byteLength(b)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{const sc=x.headers['set-cookie'];if(sc)cookie=sc[0].split(';')[0];let j=null;try{j=JSON.parse(d)}catch(e){}res({status:x.statusCode,json:j,text:d})})});r.on('error',no);if(b)r.write(b);r.end()});return f};
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const dec=s=>{let bits='';for(const c of s)bits+=B32.indexOf(c).toString(2).padStart(5,'0');const o=[];for(let i=0;i+8<=bits.length;i+=8)o.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(o)};
const totp=(secret,step)=>{const c=Buffer.alloc(8);c.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',dec(secret)).update(c).digest(),o=h[19]&15;return String(((h[o]&127)<<24|h[o+1]<<16|h[o+2]<<8|h[o+3])%1e6).padStart(6,'0')};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const smtp=await H.fakeSMTP(8982);const S=await H.startServer(P,{TRUST_PROXY:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:'8982',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <noreply@finbridge.test>',BASE_URL:'http://127.0.0.1:'+P,REMIND_ANYTIME:'true',REMIND_INTERVAL_MS:'999999999',OFFICE_QUOTA_MB:'1'});
  try{
  /* №1 */
  const own=mk();await own('POST','/api/register',{office:'Варна Строй',email:'own@v.test',password:PW,kind:'company'});
  let r=await own('PUT','/api/fin/settings',{data:{balance:0,cats:['Гориво'],approverLimit:500,seller:{name:'Варна Строй ООД',eik:'489280014',address:'София',mol:'М'}}});assert.equal(r.status,200,r.text);
  assert.equal((await own('POST','/api/fin/users',{email:'acc@v.test',password:PW,role:'accountant',name:'Счетоводител'})).status,200);
  const acc=mk();await acc('POST','/api/login',{email:'acc@v.test',password:PW});const firm=(await acc('GET','/api/firms')).json[0];assert(firm&&firm.id);
  assert.equal((await acc('DELETE','/api/firms/'+firm.id)).status,403);assert.equal((await acc('POST','/api/users',{email:'x@v.test',password:PW})).status,403);assert.equal((await acc('GET','/api/audit')).status,403);assert.equal((await acc('PUT','/api/firms/nova1',{data:{name:'Втора'}})).status,403);
  assert.equal((await acc('GET','/api/periods?period=2026-11')).status,200);assert.equal((await own('GET','/api/fin/state')).status,200);ok('#1 an invited accountant cannot delete the company, invite others or read the log, but still does the bookkeeping');
  /* №15 */
  const inv=(await own('POST','/api/fin/invoices',{data:{party:'Клиент',eik:'507081376',rate:0,vatNote:'чл. 113',lines:[{name:'x',qty:1,price:200}]}})).json;assert.equal(inv.inv.seller.name,'Варна Строй ООД');ok('#15 the registered company name can be set and appears as the seller');
  /* №8 */
  const iss=d=>own('POST','/api/fin/invoices',{data:{party:'Клиент',eik:'507081376',rate:0,vatNote:'чл. 113',lines:[{name:'x',qty:1,price:10}],...d}});
  for(const d of ['2026-02-31','2999-12-31','1900-01-01','2026-01-05','abc'])assert.equal((await iss({date:d})).status,400,d);assert.equal((await iss({})).status,200);ok('#8 invoice date must be a real day, not in the future and not before the previous invoice');
  /* №9 и №10 */
  const pay=(id,b)=>own('POST','/api/fin/items/'+id+'/pay',b),st=(id,s)=>own('POST','/api/fin/items/'+id+'/status',{status:s});
  await pay(inv.id,{amount:50});assert.equal((await st(inv.id,'void')).status,409);r=await pay(inv.id,{amount:70});assert.equal(r.json.paid,120);
  r=await st(inv.id,'paid');assert.equal(r.json.status,'paid');r=await st(inv.id,'open');assert.deepEqual([r.json.status,r.json.paid,r.json.pays.length],['open',120,2]);
  await pay(inv.id,{amount:80});r=await st(inv.id,'open');assert.deepEqual([r.json.status,r.json.paid],['open',120],'при пълно покритие се маха само последната вноска');
  const v=(await iss({})).json;assert.equal((await st(v.id,'void')).status,200);assert.equal((await st(v.id,'open')).status,409);ok('#9 #10 reopening keeps the instalments; an invoice with payments cannot be voided and a voided one stays voided');
  /* №4 */
  assert.equal((await own('POST','/api/fin/users',{email:'ap@v.test',password:PW,role:'approver',name:'Одобряващ'})).status,200);const ap=mk();await ap('POST','/api/login',{email:'ap@v.test',password:PW});
  const bill=(await own('POST','/api/fin/items',{type:'bill',data:{party:'Доставчик',date:'2026-11-03',amount:'50000'}})).json;const A=(m,u,b)=>ap(m,u,b);
  assert.equal((await A('POST','/api/fin/items/'+bill.id+'/status',{status:'approved'})).status,403);assert.equal((await A('PUT','/api/fin/items/'+bill.id,{data:{party:'Доставчик',date:'2026-11-03',amount:'100'}})).status,200);assert.equal((await A('POST','/api/fin/items/'+bill.id+'/status',{status:'approved'})).status,200);
  r=await A('PUT','/api/fin/items/'+bill.id,{data:{party:'Доставчик',date:'2026-11-03',amount:'50000'}});assert.equal(r.json.status,'submitted');assert.equal((await A('POST','/api/fin/items/'+bill.id+'/status',{status:'approved'})).status,403);assert.equal((await A('POST','/api/fin/items/'+bill.id+'/status',{status:'paid'})).status,409);ok('#4 editing an approved bill sends it back for approval, so the approver limit cannot be bypassed');
  /* №6 */
  const sec=(await own('POST','/api/2fa/setup',{password:PW})).json.secret;const t0=Math.floor(Date.now()/30000);r=await own('POST','/api/2fa/enable',{code:totp(sec,t0)});const rec=r.json.recovery;assert.equal(rec.length,8);
  const logins=code=>Promise.all(Array.from({length:3},()=>mk()('POST','/api/login',{email:'own@v.test',password:PW,code})));
  assert.equal((await logins(totp(sec,t0+1))).filter(x=>x.status===200).length,1);assert.equal((await logins(rec[0])).filter(x=>x.status===200).length,1);const own2=mk();assert.equal((await own2('POST','/api/login',{email:'own@v.test',password:PW,code:rec[1]})).status,200);ok('#6 one TOTP or recovery code admits only one of several simultaneous sign-ins');
  /* №2, №3, №11 */
  const K=mk(),K2=mk();await K('POST','/api/register',{office:'Кантора',email:'k@k.test',password:PW,kind:'office'});await K('POST','/api/users',{email:'k2@k.test',password:PW});await K2('POST','/api/login',{email:'k2@k.test',password:PW});
  await K('PUT','/api/firms/f1',{data:{name:'Клиент 1',address:'klient@example.test',contact:'Петър',auto:true}});const per=new Date(Date.now()-40*864e5).toISOString().slice(0,7);
  const tx={id:'t1',date:per+'-05',amount:-100,cp:'Енерго',desc:'ток',needsDoc:true};r=await K('PUT','/api/period/f1/'+per,{data:{txs:[tx],docs:[]}});assert.equal(r.json.version,1);
  r=await K('PUT','/api/period/f1/'+per,{version:1,data:{txs:[tx],docs:[{id:'dA'}]}});assert.equal(r.json.version,2);r=await K2('PUT','/api/period/f1/'+per,{version:1,data:{txs:[tx],docs:[{id:'dB'}]}});assert.equal(r.status,409);assert.equal(r.json.error,'conflict');
  assert.deepEqual((await K('GET','/api/period/f1/'+per)).json.data.docs.map(d=>d.id),['dA']);assert.equal((await K2('PUT','/api/period/f1/'+per,{version:2,data:{txs:[tx],docs:[{id:'dA'},{id:'dB'}]}})).json.version,3);ok('#2 a save based on a stale version is refused instead of silently overwriting a colleague');
  for(const d of [{txs:[null],docs:[]},{txs:[1],docs:[]},{txs:[],docs:['x']},{txs:[[]],docs:[]}])assert.equal((await K('PUT','/api/period/f1/'+per,{data:d})).status,400);assert.equal((await K('PUT','/api/period/f1/1999-01',{data:{txs:[],docs:[]}})).status,400);assert.equal((await K('PUT','/api/period/f1/2099-01',{data:{txs:[],docs:[]}})).status,400);
  assert.equal((await K('PUT','/api/kv/junk',{data:{x:1}})).status,404);assert.equal((await K('PUT','/api/kv/rules',{data:{sup:{},cp:{}}})).status,200);
  /* повреден период, записан преди поправката, не спира напомнянията за останалите */
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(S.dir,'finbridge.db'));db.exec('PRAGMA busy_timeout = 5000');const BadO=mk();await BadO('POST','/api/register',{office:'Лоша кантора',email:'bad@k.test',password:PW,kind:'office'});await BadO('PUT','/api/firms/a0',{data:{name:'Жертва',address:'zh@example.test',auto:true}});
  const bo=db.prepare("SELECT office_id o FROM users WHERE email='bad@k.test'").get().o;db.prepare('INSERT INTO periods(office_id, firm_id, period, data, version, updated) VALUES(?,?,?,?,?,?)').run(bo,'a0',per,JSON.stringify({firm:'a0',period:per,txs:[null,7,'x'],docs:[]}),1,'x');
  const n0=smtp.mails.length;r=await K('POST','/api/remind-now');assert.equal(r.status,200,r.text);await sleep(300);assert.equal(smtp.mails.length-n0,1);ok('#3 #11 malformed periods are refused, stray keys and far-off years too, and old bad data no longer stops reminders for others');
  /* №5 */
  const Sp=mk();await Sp('POST','/api/register',{office:'Спам',email:'sp@k.test',password:PW,kind:'office'});for(let i=0;i<15;i++){await Sp('PUT','/api/firms/s'+i,{data:{name:'Ж'+i,address:'j'+i+'@example.test',auto:true}});await Sp('PUT','/api/period/s'+i+'/'+per,{data:{txs:[tx],docs:[]}})}
  db.prepare('DELETE FROM autolog').run();const n1=smtp.mails.length;await Sp('POST','/api/remind-now');await sleep(500);const sent=smtp.mails.slice(n1).filter(m=>/j\d+@example\.test/.test(m.cmds.join(' '))).length;assert(sent<=10,'изпратени '+sent);assert(sent>=1);ok('#5 automatic reminders count against the same hourly mail limit');
  /* №12 */
  const tok=(await K('GET','/api/firms')).json[0].portal.split('/u/')[1];const png=fs.readFileSync(path.join(__dirname,'fixtures','scan-receipt.png'));
  await new Promise((res,no)=>{const q=http.request({host:'127.0.0.1',port:P,method:'POST',path:'/u/'+tok+'/upload?name=faktura.png',headers:{'x-fb':'1','content-length':png.length}},x=>{x.resume();x.on('end',res)});q.on('error',no);q.end(png)});
  const fid=(await K('GET','/api/inbox')).json[0].id;await K('GET','/api/files/'+fid);await K('POST','/api/files/'+fid+'/done');const acts=(await K('GET','/api/audit')).json.rows.map(x=>x.action);for(const a of ['Портал: качен документ','Отворен клиентски файл','Приключен клиентски файл'])assert(acts.includes(a),a+' липсва в '+acts.join(' | '));db.close();ok('#12 portal uploads and handling of client files are in the action log');
  /* №7 */
  const Core=new Function(fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8').split('/*CORE-START*/')[1].split('/*CORE-END*/')[0]+';return Core')();
  const docs=[{id:'d1',docType:'invoice',number:'1',date:'2026-10-01',supplier:'Д',supplierEik:'1',base:100,vat:20,total:120,acc:'602'},{id:'d2',docType:'credit_note',number:'2',date:'2026-10-05',supplier:'Д',supplierEik:'1',base:100,vat:20,total:120,acc:'602',txId:'t2'}],txs=[{id:'t1',date:'2026-10-06',amount:-120,cp:'Д'},{id:'t2',date:'2026-10-07',amount:120,cp:'Д'}];
  const led=Core.exportLedger({docs,txs},'.').split('\r\n').map(x=>x.split(';'));assert.deepEqual([led[1][7],led[1][8],led[2][7],led[2][8]],['100.00','20.00','-100.00','-20.00']);
  const post=Core.exportPostings({docs,txs},'.').split('\r\n').map(x=>x.split(';'));const cn=post.filter(x=>x[2]==='2');assert.deepEqual(cn.map(x=>[x[6],x[7],x[8]]),[['602','401','-100.00'],['4531','401','-20.00'],['503','401','120.00']]);
  assert.deepEqual(Core.findMatches(docs[1],[{id:'a',date:'2026-10-06',amount:-120,cp:'Д'}]),[]);assert.equal(Core.findMatches(docs[1],[{id:'b',date:'2026-10-07',amount:120,cp:'Д'}]).length,1);assert.equal(Core.findMatches(docs[0],[{id:'a',date:'2026-10-06',amount:-120,cp:'Д'}]).length,1);ok('#7 a supplier credit note lowers purchases, reverses the postings and matches a refund, not a payment');
  console.log('\n'+n+' passed');
  }finally{S.stop();smtp.close()}
})().catch(e=>{console.error('REVIEW FAIL after step '+n+':',e.message);process.exit(1)});
