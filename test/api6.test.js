const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');const H=require('./helpers');
const B='http://127.0.0.1:8901';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const client=()=>{let cookie='';return async(method,url,body,o={})=>{const h={...(o.noCsrf?{}:{'x-fb':'1'})};if(cookie)h.cookie=cookie;let b=body;if(body&&!Buffer.isBuffer(body)){b=JSON.stringify(body);h['content-type']='application/json'}
  const r=await fetch(B+url,{method,headers:h,body:b,redirect:'manual'});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const ct=r.headers.get('content-type')||'';return{status:r.status,headers:r.headers,body:ct.includes('json')?await r.json():await r.text()}}};
const PW='parola-parola-1';
(async()=>{
  const srv=await H.startServer(8901,{});
  try{
  const own=client(),mem=client(),other=client();let r;
  await own('POST','/api/register',{office:'Варна Строй ООД',email:'shef@firma.test',password:PW,kind:'company'});await other('POST','/api/register',{office:'Чужда ЕООД',email:'chuzda@firma.test',password:PW,kind:'company'});
  await own('POST','/api/fin/users',{email:'ivan@firma.test',password:PW,role:'member',name:'Иван'});await mem('POST','/api/login',{email:'ivan@firma.test',password:PW});
  const sset=(c,seller)=>c('PUT','/api/fin/settings',{data:{balance:0,cats:[],seller}});
  assert.equal((await sset(own,{eik:'489280014',vatNo:'bg489280014',address:'София, бул. Витоша 5',mol:'Мария Петрова',iban:'bg80 bnbg 9661 1020 3456 78'})).status,200);
  const issue=(c,data)=>c('POST','/api/fin/invoices',{data}),base={party:'Клиент ООД',eik:'507081376',address:'Варна',mol:'Иван Иванов',rate:20,pay:'bank',lines:[{name:'Консултация',qty:10,unit:'час',price:100},{name:'Пътни',qty:1,unit:'бр.',price:50}]};
  const state=async c=>(await c('GET','/api/fin/state')).body,item=async(c,id)=>(await state(c)).items.find(i=>i.id===id);
  const credit=(c,id,data)=>c('POST','/api/fin/invoices/'+id+'/credit',{data});

  /* ---- кредитни известия ---- */
  let inv=(await issue(own,{...base,date:'2026-11-02',due:'2026-11-16'})).body;assert.equal(inv.number,'0000000001');assert.equal(inv.amount,1260);
  r=await credit(own,inv.id,{reason:'Отстъпка от цената',date:'2026-11-10',lines:[{name:'Консултация',qty:2,unit:'час',price:100}]});assert.equal(r.status,200);
  let cn=r.body.credit;assert.deepEqual([cn.type,cn.number,cn.amount,cn.status,cn.refund,cn.ref.number,cn.ref.reason,cn.inv.net,cn.inv.vat,cn.party],['credit','0000000002',240,'issued',0,'0000000001','Отстъпка от цената',200,40,'Клиент ООД']);
  assert.deepEqual([r.body.invoice.status,r.body.invoice.credited,r.body.invoice.paid],['open',240,0]);
  assert.equal((await issue(own,{...base,date:'2026-11-12'})).body.number,'0000000003');
  ok('a credit note takes the next number from the invoice series, keeps the buyer and VAT rate of the invoice, and lowers what is owed on it');

  /* остатък и засичане с банката */
  const left=Math.round((1260-240)*100)/100;assert.equal(left,1020);
  r=await credit(own,inv.id,{reason:'Още',lines:[{name:'Консултация',qty:100,unit:'час',price:100}]});assert.equal(r.status,400);assert.equal(r.body.error,'too_much');
  r=await credit(own,inv.id,{reason:'',lines:[{name:'x',qty:1,price:1}]});assert.equal(r.body.error,'need_reason');
  r=await credit(own,inv.id,{reason:'Грешка',lines:[{name:'x',qty:0,price:1}]});assert.equal(r.status,400);
  r=await credit(own,inv.id,{reason:'Грешка',date:'2026-10-01',lines:[{name:'x',qty:1,price:1}]});assert.equal(r.body.error,'bad_date');
  assert.equal((await credit(mem,inv.id,{reason:'Грешка',lines:[{name:'x',qty:1,price:1}]})).status,403);assert.equal((await credit(other,inv.id,{reason:'Грешка',lines:[{name:'x',qty:1,price:1}]})).status,404);
  assert.equal((await credit(own,'nqma-takova-id',{reason:'Грешка',lines:[{name:'x',qty:1,price:1}]})).status,404);
  assert.equal((await own('PUT','/api/fin/items/'+cn.id,{data:{party:'x',date:'2026-11-10',amount:1}})).status,403);assert.equal((await own('DELETE','/api/fin/items/'+cn.id)).status,403);
  assert.equal((await own('POST','/api/fin/items',{type:'credit',data:{party:'x',date:'2026-11-10',amount:1}})).status,400);assert.equal((await own('POST','/api/fin/items/'+cn.id+'/status',{status:'submitted'})).status,409);
  assert.equal((await own('POST','/api/fin/items/'+inv.id+'/status',{status:'void'})).status,409);
  ok('limits: not over what is left, reason and date required, employees and other companies refused, a credit note cannot be edited, deleted or forged, an invoice with credit notes cannot be voided');

  /* частично платена + кредитно известие над платеното: връщане */
  assert.equal((await own('POST','/api/fin/items/'+inv.id+'/pay',{amount:'900',date:'2026-11-14'})).status,200);
  r=await credit(own,inv.id,{reason:'Върната стока',date:'2026-11-15',lines:[{name:'Пътни',qty:1,unit:'бр.',price:50}]});assert.equal(r.status,200);cn=r.body.credit;
  /* платено 900, дължимо след кредитите 1260-240-60=960 → без връщане */
  assert.deepEqual([cn.amount,cn.refund,cn.status],[60,0,'issued']);
  r=await credit(own,inv.id,{reason:'Много',date:'2026-11-16',lines:[{name:'Консултация',qty:8,unit:'час',price:100}]});assert.equal(r.status,200);
  /* остава дължимо 1260-240-60-960=0, платено 900 → за връщане 900 */
  const rf=r.body.credit;assert.deepEqual([rf.amount,rf.status,rf.refund,r.body.invoice.status],[960,'open',900,'paid']);
  assert.equal((await own('POST','/api/fin/items/'+rf.id+'/status',{status:'paid'})).status,200);assert.equal((await item(own,rf.id)).status,'paid');
  ok('when the customer has already paid more than the new amount due, the credit note shows what to give back and can be marked as returned');

  /* пълно кредитиране на неплатена */
  const i2=(await issue(own,{...base,date:'2026-11-17',lines:[{name:'Услуга',qty:1,price:100}]})).body;
  r=await credit(own,i2.id,{reason:'Отказана поръчка',lines:[{name:'Услуга',qty:1,unit:'бр.',price:100}]});assert.deepEqual([r.body.invoice.status,r.body.invoice.credited,r.body.credit.status],['credited',120,'issued']);
  assert.equal((await credit(own,i2.id,{reason:'Пак',lines:[{name:'Услуга',qty:1,price:1}]})).status,409);assert.equal((await own('POST','/api/fin/items/'+i2.id+'/status',{status:'open'})).status,409);
  assert.equal((await own('POST','/api/fin/items/'+i2.id+'/pay',{amount:'10'})).status,409);
  ok('a fully credited invoice becomes "credited": closed, cannot be credited again, reopened or paid');

  /* известие по платена в брой: връщане в брой */
  const i3=(await issue(own,{...base,pay:'cash',lines:[{name:'Стока',qty:2,price:50}]})).body;assert.equal(i3.status,'paid');
  r=await credit(own,i3.id,{reason:'Върната стока',lines:[{name:'Стока',qty:1,unit:'бр.',price:50}]});assert.deepEqual([r.body.credit.amount,r.body.credit.refund,r.body.credit.status,r.body.credit.pay],[60,60,'open','cash']);

  /* справки */
  r=await own('GET','/api/fin/export?kind=ledger&period=2026-11&dec=.');let L=r.body.replace('﻿','').split('\r\n').map(x=>x.split(';'));
  const row=num=>L.find(x=>x[2]===num);assert.deepEqual([row('0000000002')[1],row('0000000002')[7],row('0000000002')[9],row('0000000002')[10]],['Кредитно известие','-200.00','-40.00','-240.00']);assert(row('0000000002')[6].startsWith('Към фактура № 0000000001 от 02.11.2026: Отстъпка'));assert.equal(row('0000000001')[10],'1260.00');
  r=await own('GET','/api/fin/export?kind=postings&period=2026-11&dec=.');L=r.body.replace('﻿','').split('\r\n').map(x=>x.split(';'));
  const post=L.filter(x=>x[2]==='0000000002');assert.deepEqual(post.map(x=>[x[1],x[6],x[7],x[8]]),[['Кредитно известие','703','411','200.00'],['Кредитно известие','4532','411','40.00']]);
  const cp=L.filter(x=>x[1]==='Кредитно известие'&&x[8]==='50.00'&&x[6]==='703');assert(cp.some(x=>x[7]==='501'),'за фактура в брой кредитът отива по каса');
  ok('sales ledger and postings: credit notes with a minus sign and a reference, reversed postings (revenue and VAT debited, receivable or cash credited)');

  /* изолация */
  assert.equal((await state(other)).items.length,0);
  ok('another company sees none of it');

  /* ---- повтарящи се фактури ---- */
  const today=(await state(own)).today,mo=(d,k)=>{const t=+d.slice(0,4)*12+(+d.slice(5,7)-1)+k;return Math.floor(t/12)+'-'+String(t%12+1).padStart(2,'0')+'-'+d.slice(8,10)};
  const rec=(c,data,fq='')=>c('POST','/api/fin/recurring'+fq,{data}),rbase={...base,freq:'month',day:5,next:today,dueDays:14,mode:'confirm',lines:[{name:'Абонамент',qty:1,unit:'бр.',price:100}]};
  assert.equal((await rec(own,{...rbase,next:'2020-01-01'})).body.error,'bad_date');assert.equal((await rec(own,{...rbase,end:'2020-01-01'})).body.error,'bad_date');assert.equal((await rec(own,{...rbase,party:''})).status,400);assert.equal((await rec(mem,rbase)).status,403);
  const lastNo=async()=>Math.max(...(await state(own)).items.filter(i=>i.inv).map(i=>+i.number));const before=await lastNo();
  r=await rec(own,rbase);assert.equal(r.status,200);const tp=r.body;assert.deepEqual([tp.type,tp.status,tp.mode,tp.freq,tp.day,tp.next,tp.amount,tp.count||0],['recur','active','confirm','month',5,today,120,0]);
  assert.equal(await lastNo(),before);assert.equal((await own('GET','/api/fin/items/'+tp.id)).status,404);assert.equal((await own('PUT','/api/fin/items/'+tp.id,{data:{}})).status,404);
  ok('a recurring template is saved (confirm mode issues nothing by itself); past dates, a bad end date, employees and the generic item routes are refused');

  r=await own('POST','/api/fin/recurring/'+tp.id+'/issue');assert.equal(r.status,200);const gen=r.body.invoice;
  assert.deepEqual([gen.number,gen.date,gen.due,gen.amount,gen.status,gen.party],[String(before+1).padStart(10,'0'),today,new Date(Date.parse(today)+14*864e5).toISOString().slice(0,10),120,'open','Клиент ООД']);
  assert(/Период: [а-я]+ \d{4}$/.test(gen.note),gen.note);assert.deepEqual([r.body.recur.next,r.body.recur.count,r.body.recur.lastNumber],[mo(today.slice(0,8)+'05',1).slice(0,8)+'05',1,gen.number]);
  assert.equal((await own('POST','/api/fin/recurring/'+tp.id+'/issue')).body.error,'not_due');
  ok('issue now: a normal numbered invoice dated today with its period in the note; the schedule moves a month ahead and cannot be issued early');

  /* догонване и автоматичен режим чрез промяна на датата в базата */
  const db=new DatabaseSync(path.join(srv.dir,'finbridge.db'));
  const setNext=(id,next,extra)=>{const row=db.prepare('SELECT data FROM fin WHERE id = ?').get(id),d=JSON.parse(row.data);d.f.next=next;Object.assign(d.f,extra||{});db.prepare('UPDATE fin SET data = ? WHERE id = ?').run(JSON.stringify(d),id)};
  r=await rec(own,{...rbase,party:'Автоматичен Клиент ООД',mode:'auto',day:5,next:today,lines:[{name:'Поддръжка',qty:1,unit:'бр.',price:200}]});assert.equal(r.status,200);
  let st=await state(own);const auto=st.items.find(i=>i.id===r.body.id);assert.equal(auto.count,1);assert.equal(st.items.filter(i=>i.party==='Автоматичен Клиент ООД'&&i.type==='invoice').length,1);
  ok('automatic mode: the first invoice is issued as soon as the template is due');
  setNext(auto.id,mo(today.slice(0,8)+'05',-3).slice(0,8)+'05');
  st=await state(own);const gens=st.items.filter(i=>i.party==='Автоматичен Клиент ООД'&&i.type==='invoice');assert.equal(gens.length,1+4,'3 пропуснати месеца и текущият');
  assert.equal(new Set(gens.map(i=>i.number)).size,gens.length);const nums=gens.map(i=>+i.number).sort((a,b)=>a-b);for(let i=1;i<nums.length;i++)assert.equal(nums[i],nums[i-1]+1,'без пропуски в номерата');
  assert(st.items.find(i=>i.id===auto.id).next>today);
  assert.equal((await state(own)).items.filter(i=>i.party==='Автоматичен Клиент ООД'&&i.type==='invoice').length,5,'второ зареждане не издава повторно');
  ok('catching up after missed months: one invoice per missed month, consecutive numbers with no gaps, and loading the page again never issues twice');

  /* край, пауза, пропускане, грешка */
  r=await rec(own,{...rbase,party:'Краен Срок ООД',mode:'auto',next:today,end:today,lines:[{name:'Еднократно',qty:1,unit:'бр.',price:10}]});assert.equal((await state(own)).items.find(i=>i.id===r.body.id).status,'done');
  const pz=(await rec(own,{...rbase,party:'Пауза ООД'})).body;assert.equal((await own('POST','/api/fin/recurring/'+pz.id+'/pause',{paused:true})).body.status,'paused');
  assert.equal((await own('POST','/api/fin/recurring/'+pz.id+'/issue')).body.error,'bad_state');assert.equal((await own('POST','/api/fin/recurring/'+pz.id+'/pause',{paused:false})).body.status,'active');
  r=await own('POST','/api/fin/recurring/'+pz.id+'/skip');assert.equal(r.status,200);assert.equal(r.body.recur.next,mo(today.slice(0,8)+'05',1).slice(0,8)+'05');assert.equal((await state(own)).items.filter(i=>i.party==='Пауза ООД'&&i.type==='invoice').length,0);
  r=await own('PUT','/api/fin/recurring/'+pz.id,{data:{...rbase,party:'Пауза ООД',day:10,next:mo(today,1),mode:'auto'}});assert.equal(r.status,200);assert.deepEqual([r.body.day,r.body.mode,r.body.next],[10,'auto',mo(today,1)]);
  assert.equal((await mem('DELETE','/api/fin/recurring/'+pz.id)).status,403);assert.equal((await other('DELETE','/api/fin/recurring/'+pz.id)).status,404);assert.equal((await own('DELETE','/api/fin/recurring/'+pz.id)).status,200);
  ok('end date closes the template; pause, resume, skip, edit and delete work; employees and other companies cannot touch it');

  db.close();
  console.log('\n'+n+' passed');
  }finally{srv.stop()}
})().catch(e=>{console.error(e);process.exit(1)});
