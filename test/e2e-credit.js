const {chromium}=require(process.env.PLAYWRIGHT||'/opt/npm-tools/node_modules/playwright');const assert=require('node:assert');const H=require('./helpers');
const B='http://127.0.0.1:8911';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);const PW='dostatachno-dalga';
(async()=>{
  const srv=await H.startServer(8911,{});const b=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome'});
  try{
  const errs=[];const ctx=await b.newContext({viewport:{width:1280,height:900},acceptDownloads:true});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});
  await p.goto(B+'/login');await p.click('#swap');await p.selectOption('#kind','company');await p.fill('#office','Варна Строй ООД');await p.fill('#email','shef@firma.test');await p.fill('#password',PW);await p.click('#go');await p.waitForSelector('h1:has-text("Табло")');
  await p.click('#nav a:has-text("Екип и правила")');await p.waitForSelector('#set-form');await p.fill('[name=s_eik]','489280014');await p.fill('[name=s_vatNo]','BG489280014');await p.fill('[name=s_mol]','Мария Петрова');await p.fill('[name=s_address]','София, бул. Витоша 5');await p.click('#set-form button[type=submit]');await p.waitForSelector('.note.good');
  await p.click('#nav a:has-text("Вземания")');await p.click('[data-act=issue]');await p.fill('#issue-form [name=party]','Клиент ООД');await p.fill('#issue-form [name=l_name]','Консултация');await p.fill('#issue-form [name=l_price]','100');await p.fill('#issue-form [name=l_qty]','10');await p.click('#issue-form button[type=submit]');await p.waitForSelector('#invoice-doc');await p.click('[data-act=print-close]');
  // кредитно известие
  await p.click('button:has-text("Кредитно известие")');await p.waitForSelector('#credit-form');
  assert((await p.locator('#credit-totals').innerText()).includes('1 200,00'));
  await p.fill('#credit-form [name=l_qty]','2');assert((await p.locator('#credit-totals').innerText()).includes('240,00'));
  await p.fill('#credit-form [name=l_qty]','50');assert((await p.locator('#credit-totals').innerText()).includes('Над останалото'));
  await p.fill('#credit-form [name=l_qty]','2');await p.fill('#credit-form [name=reason]','Отстъпка от цената');await p.click('#credit-form button[type=submit]');
  await p.waitForSelector('h1:has-text("КРЕДИТНО ИЗВЕСТИЕ")');const doc=await p.locator('#invoice-doc').innerText();assert(doc.includes('Към фактура № 0000000001')&&doc.includes('Отстъпка от цената')&&doc.includes('-240,00'),doc);
  await p.click('[data-act=print-close]');
  const t=await p.locator('#main').innerText();assert(t.includes('Кредитни известия')&&t.includes('кредитирано 240,00')&&t.includes('-240,00'),t);
  ok('credit note from the invoice list: live totals, over-limit warning, printable document with the reference and a minus sign, listed with the invoice showing what was credited');
  // повтаряща се
  await p.click('[data-act=recur-new]');await p.waitForSelector('#issue-form [name=freq]');assert(!(await p.locator('#issue-form [name=date]').count()));
  await p.fill('#issue-form [name=party]','Абонат ЕООД');await p.fill('#issue-form [name=l_name]','Месечна поддръжка');await p.fill('#issue-form [name=l_price]','50');
  const today=await p.evaluate(()=>document.querySelector('#issue-form [name=next]').min);await p.fill('#issue-form [name=next]',today);await p.click('#issue-form button[type=submit]');await p.waitForSelector('.note.good:has-text("Шаблонът е записан")');
  let tt=await p.locator('#main').innerText();assert(tt.includes('Повтарящи се фактури')&&tt.includes('Абонат ЕООД')&&tt.includes('Чака издаване')&&tt.includes('с потвърждение'),tt);
  await p.click('#nav a:has-text("Табло")');await p.waitForSelector('.note.warn:has-text("повтаряща се фактура")');
  await p.click('#nav a:has-text("Вземания")');await p.click('[data-act=recur-issue]');await p.waitForSelector('h1:has-text("ФАКТУРА")');assert((await p.locator('#invoice-doc').innerText()).includes('Период:'));await p.click('[data-act=print-close]');
  tt=await p.locator('#main').innerText();assert(tt.includes('издадени 1')&&!tt.includes('Чака издаване'));
  await p.click('[data-act=recur-pause]');await p.waitForSelector('.pill:has-text("На пауза")');await p.click('[data-act=recur-del]');assert((await p.locator('[data-act=recur-del]').innerText()).includes('Потвърди'));await p.click('[data-act=recur-del]');await p.waitForSelector('.note.good:has-text("изтрит")');
  ok('recurring invoice: template form, "waiting" status and dashboard notice, one-click issue, pause, two-step delete');
  assert.deepEqual(errs,[]);ok('no JavaScript errors');
  console.log('\n'+n+' passed');
  }finally{await b.close();srv.stop()}
})().catch(e=>{console.error(e);process.exit(1)});
