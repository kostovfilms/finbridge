/* Издадена фактура по имейл: текст и документ за печат като прикачен файл (пренесено от main, PR #7). */
const assert=require('node:assert');const H=require('./helpers');
const PW='parola-parola-1',P=9061;let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
(async()=>{
  const smtp=await H.fakeSMTP(9062);
  const srv=await H.startServer(P,{SMTP_HOST:'127.0.0.1',SMTP_PORT:'9062',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <noreply@finbridge.test>',BASE_URL:'http://127.0.0.1:'+P,REMIND_INTERVAL_MS:'999999999'});
  try{
  const own=H.client(P),mem=H.client(P);await own('POST','/api/register',{office:'Варна Строй ООД',email:'shef@firma.test',password:PW,kind:'company'});
  assert.equal((await own('PUT','/api/fin/settings',{data:{cats:['Други'],seller:{eik:'507081376',address:'Варна',mol:'Иван Петров',iban:'BG80BNBG96611020345678',bank:'БНБ'}}})).status,200);
  await own('POST','/api/fin/users',{email:'ivan@firma.test',password:PW,role:'member',name:'Иван'});await mem('POST','/api/login',{email:'ivan@firma.test',password:PW});
  let r=await own('POST','/api/fin/invoices',{data:{party:'Клиент ООД',eik:'507081376',address:'Варна',mol:'Иван Иванов',rate:20,pay:'bank',lines:[{name:'Консултация <b>',qty:2,unit:'час',price:100}]}});assert.equal(r.status,200,r.text);const inv=r.json;
  assert.equal((await mem('POST','/api/fin/invoices/'+inv.id+'/send',{to:'klient@example.test'})).status,403);
  assert.equal((await own('POST','/api/fin/invoices/'+inv.id+'/send',{to:'not-an-email'})).status,400);
  const sent0=smtp.mails.length;
  r=await own('POST','/api/fin/invoices/'+inv.id+'/send',{to:'Klient@Example.test',message:'Здравейте, ето фактурата.'});assert.equal(r.status,200,r.text);assert.equal(r.json.mailTo,'klient@example.test');
  assert.equal(smtp.mails.length,sent0+1);const mail=smtp.mails.at(-1);assert(mail.cmds.includes('RCPT TO:<klient@example.test>'));
  const bd=/boundary="([^"]+)"/.exec(mail.body)[1],parts=mail.body.split('--'+bd).slice(1,-1);assert.equal(parts.length,2);
  const b64=p=>Buffer.from(p.split('\n\n').slice(1).join('').replace(/\s/g,''),'base64').toString('utf8'),text=b64(parts[0]),att=b64(parts[1]);
  assert(text.startsWith('Здравейте, ето фактурата.'));assert(text.includes('Фактура № '+inv.number));assert(text.includes('IBAN: BG80BNBG96611020345678'),text);assert(text.includes('Сума за плащане: 200.00'),text);
  assert(/filename\*=UTF-8''%D0%A4%D0%B0%D0%BA%D1%82%D1%83%D1%80%D0%B0-\d{10}\.html/.test(parts[1]));assert(att.includes('ФАКТУРА № '+inv.number));assert(att.includes('Консултация &lt;b&gt;'),'текстът е екраниран');assert(!/<script/i.test(att));
  const st=(await own('GET','/api/fin/state')).json;r=st.items.find(i=>i.id===inv.id);assert.equal(r.log.at(-1).what,'sent');assert.equal(r.mailTo,'klient@example.test');assert.equal(st.mail,true);
  await H.sleep(200);assert((await own('GET','/api/audit')).json.rows.some(x=>x.action==='Изпратена фактура по имейл'));
  assert.equal((await own('POST','/api/fin/refresh')).status,200);
  ok('an issued invoice is e-mailed with a text summary and a printable attachment; the address is remembered; employees cannot send; the action is logged');
  /* обикновено писмо без прикачен файл остава просто писмо */
  await own('POST','/api/forgot',{email:'ivan@firma.test'});await H.sleep(300);const plain=smtp.mails.at(-1);assert(!/multipart/.test(plain.body));assert(H.mailText(plain).includes('/reset#'));
  ok('letters without an attachment stay plain text');
  console.log('Invoice mail: all '+n+' checks passed');
  }finally{srv.stop();smtp.close()}
})().catch(e=>{console.error('Invoice mail FAIL after check '+n+':',e);process.exit(1)});
