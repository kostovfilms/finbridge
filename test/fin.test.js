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
console.log('FIN: all '+n+' tests passed');
