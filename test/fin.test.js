const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path');
const Fin=new Function(fs.readFileSync(path.join(__dirname,'..','public','company.html'),'utf8').split('/*FIN-START*/')[1].split('/*FIN-END*/')[0]+';return Fin')();
let n=0;const t=(m,f)=>{f();console.log('ok   '+(++n)+'. '+m)};
const it=(id,type,status,amount,x={})=>({id,type,status,amount,owner:'u1',party:'Доставчик',date:'2026-11-10',due:'',cat:'',budget:'',pay:'own',file:null,...x});
t('approval rights: owner always, approver not own requests and only up to the limit, member never',()=>{
  const e=it('e1','expense','submitted',300);
  assert.equal(Fin.canApprove(e,{id:'u1',role:'owner'},{approverLimit:100}).ok,true);
  assert.equal(Fin.canApprove(e,{id:'u1',role:'approver'},{approverLimit:0}).ok,false);
  assert.equal(Fin.canApprove(e,{id:'u2',role:'approver'},{approverLimit:0}).ok,true);
  assert.equal(Fin.canApprove(e,{id:'u2',role:'approver'},{approverLimit:300}).ok,true);
  assert.match(Fin.canApprove(e,{id:'u2',role:'approver'},{approverLimit:299.99}).why,/лимита/);
  assert.equal(Fin.canApprove(e,{id:'u2',role:'member'},{approverLimit:0}).ok,false);
});
t('budget usage: by explicit budget or by category, approved and paid count as spent, submitted as pending, other months ignored',()=>{
  const items=[it('b1','budget','active',0,{name:'Гориво',cat:'Гориво и транспорт',limit:500}),it('b2','budget','active',0,{name:'Проект А',cat:'',limit:1000}),
    it('e1','expense','approved',200,{cat:'Гориво и транспорт'}),it('e2','expense','paid',150.5,{cat:'Гориво и транспорт'}),it('e3','expense','submitted',90,{cat:'Гориво и транспорт'}),it('e4','expense','rejected',999,{cat:'Гориво и транспорт'}),
    it('e5','expense','approved',70,{cat:'Гориво и транспорт',date:'2026-10-30'}),it('e6','bill','approved',1200,{cat:'Гориво и транспорт',budget:'b2'}),it('i1','invoice','open',5000)];
  const u=Fin.budgetUsage(items,'2026-11');
  assert.deepEqual(u.map(b=>[b.name,b.spent,b.pending,b.left,b.pct]),[['Гориво',350.5,90,149.5,70],['Проект А',1200,0,-200,120]]);
});
t('policy warnings: missing receipt above the threshold, future date, duplicate, over budget',()=>{
  const b=it('b1','budget','active',0,{name:'Реклама',cat:'Реклама',limit:100});
  const a=it('e1','expense','submitted',80,{cat:'Реклама'}),dup=it('e2','expense','approved',80,{cat:'Реклама',party:'ДОСТАВЧИК'});
  assert.deepEqual(Fin.violations(a,[b,a,dup],{receiptOver:50},'2026-11-15'),['няма документ','възможен дубликат','над бюджета „Реклама“']);
  assert.deepEqual(Fin.violations({...a,file:{name:'x'}},[b,a],{receiptOver:50},'2026-11-01'),['бъдеща дата']);
  assert.deepEqual(Fin.violations(a,[a],{receiptOver:80},'2026-11-15'),[]);
  assert.deepEqual(Fin.violations(it('i','invoice','open',5),[],{receiptOver:0},'2026-11-15'),[]);
});
t('cash forecast: receivables and payables by due week, overdue ones and reimbursements land in the first week',()=>{
  const items=[it('i1','invoice','open',1000,{due:'2026-11-20'}),it('i2','invoice','open',400,{due:'2026-11-01'}),it('i3','invoice','paid',9999,{due:'2026-11-20'}),
    it('p1','bill','approved',700,{due:'2026-11-16'}),it('p2','bill','submitted',2500,{due:'2026-11-25'}),it('p3','bill','paid',9999,{due:'2026-11-16'}),it('p4','bill','rejected',9999,{due:'2026-11-16'}),
    it('e1','expense','approved',50,{pay:'own'}),it('e2','expense','approved',60,{pay:'card'}),it('e3','expense','submitted',70,{pay:'own'})];
  const f=Fin.forecast(items,{balance:1000},'2026-11-15',3);
  assert.deepEqual(f.map(w=>[w.start,w.in,w.out,w.balance]),[['2026-11-15',1400,750,1650],['2026-11-22',0,2500,-850],['2026-11-29',0,0,-850]]);
  assert.equal(Fin.forecast([],{},'2026-11-15').length,8);
});
t('receivables aging buckets and overdue list sorted by lateness',()=>{
  const a=Fin.aging([it('i1','invoice','open',100,{due:'2026-11-15'}),it('i2','invoice','open',200,{due:'2026-11-05'}),it('i3','invoice','open',300,{due:'2026-10-01'}),it('i4','invoice','open',400,{due:'',date:'2026-08-01'}),it('i5','invoice','paid',900,{due:'2026-01-01'})],'2026-11-15');
  assert.deepEqual([a.notDue,a.d30,a.d60,a.older,a.total],[100,200,300,400,1000]);assert.deepEqual(a.overdue.map(i=>[i.id,i.late]),[['i4',106],['i3',45],['i2',10]]);
});
t('summary, category totals, money format and CSV escaping',()=>{
  const items=[it('e1','expense','submitted',10),it('p1','bill','submitted',20.5),it('p2','bill','approved',100,{cat:'Наем'}),it('e2','expense','approved',30,{pay:'own',cat:'Наем'}),it('e3','expense','approved',40,{pay:'card'}),it('i1','invoice','open',500)];
  assert.deepEqual(Fin.summary(items),{waitN:2,waitSum:30.5,payN:2,paySum:130,recvSum:500});
  assert.deepEqual(Fin.byCat(items,'2026-11'),[{cat:'Наем',sum:130},{cat:'Без категория',sum:40}]);
  assert.equal(Fin.money(1234567.5),'1 234 567,50');assert.equal(Fin.money(-12),'-12,00');
  assert.equal(Fin.toCsv([['а','б;в'],['г"д',null]]),'﻿а;"б;в"\r\n"г""д";');
});
const Core=new Function(fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8').split('/*CORE-START*/')[1].split('/*CORE-END*/')[0]+';return Core')();
const tx=(key,date,cp,amount,desc='')=>({key:'2026-11/'+key,date,cp,desc,amount});
t('bank matching: closes a record only for one unambiguous pair by name or invoice number; the rest become suggestions',()=>{
  const items=[it('i1','invoice','open',6000,{party:'Клиент АД',number:'0000000051',date:'2026-11-01'}),it('b1','bill','approved',2340,{party:'Бетон Трейд ООД',date:'2026-11-03'}),
    it('b2','bill','submitted',900,{party:'Наем Техника ООД',date:'2026-11-03'}),it('i2','invoice','open',500,{party:'Алфа Консулт',date:'2026-11-02'}),
    it('i3','invoice','open',700,{party:'Двойник ООД',date:'2026-11-02'}),it('i4','invoice','open',700,{party:'Двойник ООД',date:'2026-11-04'}),
    it('e1','expense','approved',80,{party:'OMV',pay:'card',date:'2026-11-10'}),it('e2','expense','approved',45,{party:'Шел',pay:'own',date:'2026-11-10'}),it('e3','expense','submitted',33,{party:'Лукойл',pay:'card',date:'2026-11-10'}),
    it('i5','invoice','open',1200,{party:'Гама ЕООД',number:'0000001234',date:'2026-11-05'}),it('i6','invoice','open',300,{party:'Стар Клиент',date:'2026-05-01'}),it('i7','invoice','paid',6000,{party:'Клиент АД',date:'2026-11-01'})];
  const txs=[tx('t1','2026-11-12','KLIENT AD',6000),tx('t2','2026-11-14','BETON TREYD OOD',-2340),tx('t3','2026-11-14','NAEM TEHNIKA',-900),tx('t4','2026-11-13','DRUGO IME',500),tx('t5','2026-11-12','DVOYNIK OOD',700),
    tx('t6','2026-11-11','OMV VARNA 123 POS',-80),tx('t7','2026-11-11','SHEL',-45),tx('t8','2026-11-11','LUKOIL',-33),tx('t9','2026-11-09','NEPOZNAT','1200'*1,'plashtane po f-ra 1234'),tx('t10','2026-11-12','STAR KLIENT',300),tx('t11','2026-11-12','KLIENT AD',-6000)];
  const r=Fin.matchBank(items,txs,Core.nameSim),k=x=>x.id+'>'+x.key.split('/')[1];
  assert.deepEqual(r.auto.map(k).sort(),['b1>t2','e1>t6','i1>t1','i5>t9']);assert.equal(r.auto.find(a=>a.id==='i1').date,'2026-11-12');
  assert.deepEqual(r.suggest.map(x=>k(x)+(x.strong?'':'?')).sort(),['b2>t3','i2>t4?','i3>t5','i4>t5']);
  const again=Fin.matchBank(items.map(i=>i.id==='i1'?{...i,bankTx:'2026-11/t1',status:'paid'}:i.id==='b1'?{...i,noAuto:true}:i.id==='i2'?{...i,skip:['2026-11/t4']}:i),txs,Core.nameSim);
  assert.deepEqual(again.auto.map(k).sort(),['e1>t6','i5>t9']);assert.deepEqual(again.suggest.map(k).sort(),['b1>t2','b2>t3','i3>t5','i4>t5']);
  assert.deepEqual(Fin.matchBank(items,[tx('t1','2026-11-12','KLIENT AD',6000.02)],Core.nameSim),{auto:[],suggest:[]});
});
t('payment reminder text for an overdue invoice',()=>{
  const s=Fin.dunningText(it('i1','invoice','open',1234.5,{number:'0000000051',date:'2026-10-01',due:'2026-10-15'}),'Варна Строй ООД','€','2026-11-15');
  assert(s.includes('фактура № 0000000051 от 01.10.2026 на стойност 1 234,50 € беше с падеж 15.10.2026 и към днес е просрочена с 31 дни.')&&s.endsWith('Поздрави,\nВарна Строй ООД'),s);
  assert(Fin.dunningText(it('i1','invoice','open',5,{date:'2026-11-14',due:''}),'Х','€','2026-11-15').includes('фактура от 14.11.2026 на стойност 5,00 € беше с падеж 14.11.2026 и към днес е просрочена с 1 ден.'));
});
t('partial payments: instalments with the invoice number apply on their own up to the balance, name-only ones are offered, totals use the balance left',()=>{
  const items=[it('i1','invoice','open',1200,{party:'Гама ЕООД',number:'0000001234',date:'2026-11-01',due:'2026-11-10'}),it('i2','invoice','open',900,{party:'Делта ООД',date:'2026-11-01',paid:300,pays:[{date:'2026-11-05',amount:300,bank:'2026-11/p0'}]}),
    it('b1','bill','approved',5000,{party:'Бетон Трейд ООД',date:'2026-11-02',due:'2026-11-20'}),it('b2','bill','submitted',800,{party:'Наем Техника ООД',number:'777',date:'2026-11-02'}),it('e1','expense','approved',100,{party:'OMV',pay:'card',date:'2026-11-10'})];
  const txs=[tx('p0','2026-11-05','DELTA OOD',300),tx('p1','2026-11-06','NEPOZNAT',400,'f-ra 1234'),tx('p2','2026-11-08','GAMA EOOD',500,'faktura 0000001234'),tx('p3','2026-11-12','GAMA',400,'po f 1234'),
    tx('p4','2026-11-09','DELTA OOD',600),tx('p5','2026-11-10','BETON TREYD OOD',-2000),tx('p6','2026-11-11','NEPOZNAT',-50),tx('p7','2026-11-11','NAEM TEHNIKA',-300,'f 777'),tx('p8','2026-11-11','OMV',-40)];
  const r=Fin.matchBank(items,txs,Core.nameSim),k=x=>x.id+'>'+x.key.split('/')[1]+(x.part?'~':'');
  assert.deepEqual(r.auto.map(k).sort(),['i1>p1~','i1>p2~','i2>p4']);assert.deepEqual(r.auto.find(a=>a.key.endsWith('p1')),{id:'i1',key:'2026-11/p1',date:'2026-11-06',amount:400,part:true});
  assert.deepEqual(r.suggest.map(k).sort(),['b1>p5~','b2>p7~']);
  const paidUp=items.map(i=>i.id==='i1'?{...i,paid:900,pays:[{bank:'2026-11/p1'},{bank:'2026-11/p2'}]}:i);assert.deepEqual(Fin.matchBank(paidUp,[tx('p9','2026-11-13','GAMA EOOD',300)],Core.nameSim).auto.map(k),['i1>p9']);
  assert.equal(Fin.left(items[1]),600);assert.deepEqual([Fin.summary(items).recvSum,Fin.summary(items).paySum,Fin.summary(items).waitSum],[1800,5000,800]);
  const a=Fin.aging(items,'2026-11-15');assert.deepEqual([a.total,a.d30,a.overdue.map(i=>[i.id,i.left])],[1800,1800,[['i2',600],['i1',1200]]]);
  assert.deepEqual(Fin.forecast(items,{balance:0},'2026-11-15',1).map(w=>[w.in,w.out]),[[1800,5800]]);
  assert(Fin.dunningText(items[1],'Х','€','2026-11-15').includes('на стойност 900,00 €, от които остават за плащане 600,00 €, беше с падеж'));
});
t('invoice totals, sales ledger and sales postings',()=>{
  assert.deepEqual(Fin.invoiceTotals([{qty:2,price:10.555},{qty:1.5,price:100}],20),{rows:[{qty:2,price:10.555,sum:21.11},{qty:1.5,price:100,sum:150}],net:171.11,vat:34.22,total:205.33});
  assert.deepEqual([Fin.invoiceTotals([{qty:3,price:9.99}],0).total,Fin.invoiceTotals([],20).total,Fin.invoiceTotals([{qty:1,price:100}],9).vat],[29.97,0,9]);
  const inv=(id,number,date,net,rate,x={})=>it(id,'invoice','open',Math.round(net*(100+rate))/100,{party:'Клиент '+id,number,date,pay:'bank',inv:{buyer:{eik:'20000000'+id.slice(1),vatNo:rate?'BG20000000'+id.slice(1):''},lines:[{name:'Услуга '+id}],rate,net,vat:Math.round(net*rate)/100,vatNote:rate?'':'чл. 113, ал. 9 от ЗДДС',rev:'703'},...x});
  const items=[inv('i2','0000000002','2026-11-05',100,20,{status:'paid',paidAt:'2026-11-20'}),inv('i1','0000000001','2026-11-03',1000,20,{paid:400,pays:[{date:'2026-11-10',amount:400,bank:''},{date:'2026-12-01',amount:100,bank:''}]}),
    inv('i3','0000000003','2026-11-07',50,0,{status:'void'}),inv('i4','0000000004','2026-11-08',200,9,{pay:'cash',status:'paid',paidAt:'2026-11-08'}),inv('i5','0000000005','2026-12-01',70,20),
    it('m1','invoice','paid',300,{party:'Ръчна',number:'77',date:'2026-10-01',paidAt:'2026-11-15'}),it('b1','bill','paid',999,{paidAt:'2026-11-15'})];
  assert.deepEqual(Fin.salesLedger(items,'2026-11').slice(1),[[1,'Фактура','0000000001','03.11.2026','BG200000001','Клиент i1','Услуга i1','1000,00','20%','200,00','1200,00','',''],[2,'Фактура','0000000002','05.11.2026','BG200000002','Клиент i2','Услуга i2','100,00','20%','20,00','120,00','',''],
    [3,'Фактура','0000000003','07.11.2026','200000003','Клиент i3','Услуга i3','0,00','0%','0,00','0,00','чл. 113, ал. 9 от ЗДДС','Анулирана'],[4,'Фактура','0000000004','08.11.2026','BG200000004','Клиент i4','Услуга i4','200,00','9%','18,00','218,00','','']]);
  assert.deepEqual(Fin.salesPostings(items,'2026-11','.').slice(1).map(r=>[r[0],r[2],r[6],r[7],r[8]]),[['03.11.2026','0000000001','411','703','1000.00'],['03.11.2026','0000000001','411','4532','200.00'],['05.11.2026','0000000002','411','703','100.00'],['05.11.2026','0000000002','411','4532','20.00'],
    ['08.11.2026','0000000004','501','703','200.00'],['08.11.2026','0000000004','501','4532','18.00'],['10.11.2026','0000000001','503','411','400.00'],['15.11.2026','77','503','411','300.00'],['20.11.2026','0000000002','503','411','120.00']]);
  assert.equal(Fin.salesLedger(items,'2026-09').length,1);
});
t('credit notes lower what is left, so a payment for the reduced amount matches the invoice',()=>{
  const inv=it('i1','invoice','open',600,{party:'Алфа Трейд ООД',number:'0000000005',date:'2026-11-03',due:'2026-11-17',credited:120,paid:0});
  assert.equal(Fin.left(inv),480);assert.equal(Fin.left({...inv,paid:100}),380);
  const txs=[{key:'2026-11/t1',date:'2026-11-10',cp:'АЛФА ТРЕЙД ООД',desc:'Плащане по фактура 0000000005',amount:480}];
  const res=Fin.matchBank([inv],txs,(a,b)=>a.toLowerCase().includes('алфа')&&b.toLowerCase().includes('алфа')?1:0);
  assert.deepEqual(res.auto.map(a=>[a.id,a.amount,!!a.part]),[['i1',480,false]]);
  const full=Fin.matchBank([{...inv,credited:0}],txs,()=>1);assert.equal(full.auto.length,0,'без кредитно известие 480 е само част от 600');
});
t('schedules: month, quarter and year steps keep the chosen day and never overflow short months',()=>{
  assert.equal(Fin.addMonths('2026-11-05',1,5),'2026-12-05');assert.equal(Fin.addMonths('2026-12-05',1,5),'2027-01-05');assert.equal(Fin.addMonths('2026-11-05',3,5),'2027-02-05');assert.equal(Fin.addMonths('2026-11-05',12,5),'2027-11-05');
  assert.equal(Fin.addMonths('2027-01-28',1,28),'2027-02-28');assert.equal(Fin.addMonths('2026-01-31',1,40),'2026-02-28');assert.equal(Fin.addMonths('2026-12-28',-12,28),'2025-12-28');
});
t('credit notes appear in the ledger with a minus sign and reverse the postings',()=>{
  const inv={id:'a',type:'invoice',status:'open',amount:120,date:'2026-11-03',number:'0000000001',party:'Клиент',pay:'bank',inv:{buyer:{eik:'123456789',vatNo:''},seller:{},lines:[{name:'Услуга'}],rate:20,net:100,vat:20,vatNote:'',rev:'703'}};
  const cr={id:'b',type:'credit',status:'issued',amount:60,date:'2026-11-08',number:'0000000002',party:'Клиент',pay:'bank',ref:{number:'0000000001',date:'2026-11-03',reason:'Отстъпка'},inv:{buyer:{eik:'123456789',vatNo:''},seller:{},lines:[{name:'Услуга'}],rate:20,net:50,vat:10,vatNote:'',rev:'703'}};
  const L=Fin.salesLedger([inv,cr],'2026-11','.');assert.deepEqual(L[2].slice(1,3).concat(L[2].slice(7,11)),['Кредитно известие','0000000002','-50.00','20%','-10.00','-60.00']);
  const P=Fin.salesPostings([inv,cr],'2026-11','.').slice(1).filter(r=>r[2]==='0000000002').map(r=>[r[6],r[7],r[8]]);assert.deepEqual(P,[['703','411','50.00'],['4532','411','10.00']]);
});
console.log('FIN: all '+n+' tests passed');
