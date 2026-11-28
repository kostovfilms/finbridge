/* Известия до поддръжката: вътрешна грешка, неизпратено напомняне, неиздадена повтаряща се фактура. По имейл и към webhook, с таван. */
const assert=require('node:assert'),http=require('node:http'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');const H=require('./helpers');
const PW='parola-parola-1',P=9041;let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
(async()=>{
  const smtp=await H.fakeSMTP(9042),hooks=[],hook=http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{hooks.push(JSON.parse(b));r.end('ok')})}).listen(9043);
  const srv=await H.startServer(P,{SMTP_HOST:'127.0.0.1',SMTP_PORT:'9042',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <noreply@finbridge.test>',BASE_URL:'http://127.0.0.1:'+P,
    ALERT_EMAIL:'ops@finbridge.test',ALERT_WEBHOOK:'http://127.0.0.1:9043/hook',REMIND_ANYTIME:'true',REMIND_INTERVAL_MS:'999999999'});
  const db=new DatabaseSync(path.join(srv.dir,'finbridge.db'),{timeout:5000}),ops=()=>smtp.mails.filter(m=>m.cmds.includes('RCPT TO:<ops@finbridge.test>')).map(H.mailText);
  try{
  const C=H.client(P);await C('POST','/api/register',{office:'Фирма И ЕООД',email:'c@c.test',password:PW,kind:'company'});
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON fin BEGIN SELECT RAISE(ABORT,'проба за известие'); END");
  assert.equal((await C('POST','/api/fin/items',{type:'expense',data:{party:'Магазин',date:'2026-11-02',amount:5}})).status,500);await H.sleep(400);
  assert.equal(ops().length,1);assert(ops()[0].includes('POST /api/fin/items: проба за известие'),ops()[0]);
  assert.equal(hooks.length,1);assert(hooks[0].text.includes('вътрешна грешка на сървъра')&&hooks[0].text.includes('проба за известие'));
  assert.equal((await C('POST','/api/fin/items',{type:'expense',data:{party:'Магазин',date:'2026-11-02',amount:5}})).status,500);await H.sleep(400);
  assert.deepEqual([ops().length,hooks.length],[1,1],'второто известие от същия вид чака');db.exec('DROP TRIGGER boom');
  ok('a server error sends one e-mail and one webhook alert; a repeat within the hour is held back');

  /* напомняне, което SMTP сървърът отказва */
  const A=H.client(P);await A('POST','/api/register',{office:'Кантора И',email:'a@a.test',password:PW});
  await A('PUT','/api/firms/f1',{data:{name:'Клиент Отказ ООД',address:'reject@klient.test',auto:true}});
  const t=new Date(),prev=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()-1,1)).toISOString().slice(0,7);
  assert.equal((await A('PUT','/api/period/f1/'+prev,{data:{txs:[{id:'t1',date:prev+'-05',amount:-50,cp:'Доставчик',needsDoc:true}],docs:[]}})).status,200);
  assert.equal((await A('POST','/api/remind-now')).json.sent,0);await H.sleep(400);
  const rm=ops().find(x=>x.includes('reject@klient.test'));assert(rm&&rm.includes('Клиент Отказ ООД')&&rm.includes('550'),String(rm));
  ok('a reminder the mail server refuses raises an alert that names the client and the reason');

  /* повтаряща се фактура, която не може да се издаде */
  assert.equal((await C('PUT','/api/fin/settings',{data:{cats:['Други'],seller:{eik:'507081376',address:'София',mol:'Иван Петров'}}})).status,200);
  const today=(await C('GET','/api/fin/state')).json.today;
  let r=await C('POST','/api/fin/recurring',{data:{party:'Абонат ООД',lines:[{name:'Абонамент',qty:1,price:50}],freq:'month',next:today,mode:'confirm'}});assert.equal(r.status,200,r.text);
  const row=db.prepare('SELECT data FROM fin WHERE id=?').get(r.json.id),d=JSON.parse(row.data);d.f.mode='auto';db.prepare('UPDATE fin SET data=? WHERE id=?').run(JSON.stringify(d),r.json.id);
  db.prepare("UPDATE finset SET data=json_set(data,'$.seller',json('{}'))").run();
  await C('GET','/api/fin/state');await H.sleep(400);
  const rc=ops().find(x=>x.includes('Абонат ООД'));assert(rc&&rc.includes('не беше издадена')&&rc.includes('Фирма И ЕООД'),String(rc));
  ok('a recurring invoice that cannot be issued automatically raises an alert');
  console.log('Alerts: all '+n+' checks passed');
  }finally{db.close();srv.stop();smtp.close();hook.close()}
})().catch(e=>{console.error('Alerts FAIL after check '+n+':',e);process.exit(1)});
