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
console.log('FIN: all '+n+' tests passed');
