/* Находки №20, №27 и №29 от REVIEW.md през истински браузър: лента за потвърждение на имейла, предупреждения при импорт и при издаване. */
const {chromium}=require(process.env.PLAYWRIGHT||'/opt/npm-tools/node_modules/playwright');const assert=require('node:assert');const H=require('./helpers');
const B='http://127.0.0.1:9011',PW='dostatachno-dalga';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const mailText=m=>{const b=m.body.split('\n\n').slice(1).join('').replace(/\n/g,'');try{return Buffer.from(b,'base64').toString()}catch(e){return m.body}};
(async()=>{
  const smtp=await H.fakeSMTP(9012);
  const srv=await H.startServer(9011,{EMAIL_VERIFY:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:'9012',SMTP_SECURE:'false',SMTP_FROM:'FinBridge <noreply@finbridge.test>',BASE_URL:B,REMIND_INTERVAL_MS:'999999999'});
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome'});
  try{
  const errs=[];const watch=p=>{p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())})};
  /* кантора: лента за потвърждение и предупреждение за двусмислена сума */
  const ctx=await br.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();watch(p);
  await p.goto(B+'/login');await p.click('#swap');await p.fill('#office','Кантора Проверка');await p.fill('#email','ivan@proverka.test');await p.fill('#password',PW);await p.click('#go');await p.waitForSelector('text=Как се работи');
  await p.waitForSelector('.note.warn:has-text("Потвърдете имейла си")');await p.click('[data-act=verify-resend]');await p.waitForSelector('text=Изпратихме ново писмо за потвърждение.');
  ok('#20 an unconfirmed accountant sees the confirm-your-e-mail bar and can ask for the letter again');
  await p.click('text=Добави фирма');await p.fill('#firm-name','Клиент Извлечение ООД');await p.click('button:has-text("Запази")');await p.waitForSelector('tr:has-text("Клиент Извлечение ООД")');await p.fill('#period','2026-11');
  await p.goto(B+'/#reconcile');
  await p.setInputFiles('#stmt-file',{name:'izvlechenie.csv',mimeType:'text/csv',buffer:Buffer.from('Дата;Сума;Контрагент;Описание\n03.11.2026;-1.234;Доставчик ООД;фактура 1\n04.11.2026;-12,50;Друг ЕООД;фактура 2\n')});
  await p.waitForSelector('text=Преглед преди импорт');assert((await p.locator('#main').innerText()).includes('1 сума е с един разделител и три цифри след него'));
  ok('#27 the import preview warns that an amount like 1.234 was read as thousands');
  /* фирма: предупреждение за ЕИК при издаване, потвърждение по връзката от писмото */
  const c2=await br.newContext({viewport:{width:1280,height:900}});const q=await c2.newPage();watch(q);
  await q.goto(B+'/login');await q.click('#swap');await q.selectOption('#kind','company');await q.fill('#office','Фирма Проверка');await q.fill('#email','shef@proverka.test');await q.fill('#password',PW);await q.click('#go');await q.waitForSelector('h1:has-text("Табло")');
  await q.waitForSelector('.note.warn:has-text("Потвърдете имейла си")');
  await q.click('#nav a:has-text("Вземания")');await q.click('[data-act=issue]');await q.fill('#issue-form [name=party]','Клиент ООД');await q.fill('#issue-form [name=eik]','0000000000');
  await q.waitForSelector('#issue-totals .note.warn:has-text("контролна цифра")');await q.fill('#issue-form [name=eik]','507081376');await q.fill('#issue-form [name=vatNo]','BG507081376');
  await q.waitForFunction(()=>!document.querySelector('#issue-totals .note.warn'));
  ok('#29 the invoice form warns about an EIK with a wrong control digit and the warning goes away once it is right');
  await new Promise(r=>setTimeout(r,300));const m=smtp.mails.filter(x=>x.cmds.includes('RCPT TO:<shef@proverka.test>')).pop();const link=/(http:\/\/\S+\/verify#[A-Za-z0-9_-]+)/.exec(mailText(m))[1];
  await q.goto(link);await q.waitForSelector('text=Имейлът е потвърден. Влезте в акаунта си.');assert(!(await q.url()).includes('#'),'жетонът не остава в адреса');
  await q.goto(B+'/company');await q.waitForSelector('h1:has-text("Табло")');assert.equal(await q.locator('.note.warn:has-text("Потвърдете имейла си")').count(),0);
  ok('#20 the link from the letter confirms the address and the bar disappears');
  assert.deepEqual(errs,[]);console.log('E2E review2: all '+n+' steps passed');
  }finally{await br.close();srv.stop();smtp.close()}
})().catch(e=>{console.error('E2E review2 FAIL after step '+n+':',e.message);process.exit(1)});
