/* Находки №10, №13, №14, №15 от REVIEW.md през истински браузър. */
const {chromium}=require(process.env.PLAYWRIGHT||'/opt/npm-tools/node_modules/playwright');const assert=require('node:assert');const H=require('./helpers');
const B='http://127.0.0.1:8991',PW='dostatachno-dalga';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
(async()=>{
  const srv=await H.startServer(8991,{});const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome'});
  try{
  const errs=[];const ctx=await br.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});
  await p.goto(B+'/login');await p.click('#swap');await p.selectOption('#kind','company');await p.fill('#office','Варна Строй');await p.fill('#email','shef@firma.test');await p.fill('#password',PW);await p.click('#go');await p.waitForSelector('h1:has-text("Табло")');
  /* №13 */
  await p.click('#nav a:has-text("Плащания")');await p.click('[data-act=new][data-type=bill]');await p.waitForSelector('#item-form');await p.fill('#item-form [name=party]','Бетон Трейд ООД');await p.fill('#item-form [name=number]','1000000416');await p.fill('#item-form [name=note]','за обекта във Варна');
  await p.click('#item-form button[type=submit]');await p.waitForSelector('.note.crit');assert.deepEqual([await p.inputValue('#item-form [name=party]'),await p.inputValue('#item-form [name=number]'),await p.inputValue('#item-form [name=note]')],['Бетон Трейд ООД','1000000416','за обекта във Варна']);
  await p.click('#nav a:has-text("Екип и правила")');await p.waitForSelector('#set-form');await p.fill('[name=s_name]','Варна Строй ООД');await p.fill('[name=s_eik]','123');await p.fill('[name=s_mol]','Мария Петрова');await p.fill('[name=s_address]','София, бул. Витоша 5');await p.click('#set-form button[type=submit]');await p.waitForSelector('.note.crit');
  assert.deepEqual([await p.inputValue('[name=s_mol]'),await p.inputValue('[name=s_address]'),await p.inputValue('[name=s_name]')],['Мария Петрова','София, бул. Витоша 5','Варна Строй ООД']);ok('#13 a refused form keeps what was typed (supplier bill, company details)');
  /* №15 */
  await p.fill('[name=s_eik]','489280014');await p.click('#set-form button[type=submit]');await p.waitForSelector('.note.good');
  await p.click('#nav a:has-text("Вземания")');await p.click('[data-act=issue]');await p.fill('#issue-form [name=party]','Клиент ООД');await p.fill('#issue-form [name=l_name]','Консултация');await p.fill('#issue-form [name=l_price]','100');await p.click('#issue-form button[type=submit]');await p.waitForSelector('#invoice-doc');assert((await p.locator('#invoice-doc').innerText()).includes('Варна Строй ООД'));await p.click('[data-act=print-close]');ok('#15 the registered name set in the rules is printed as the seller');
  /* №10 */
  await p.click('[data-act=void]');await p.waitForSelector('button:has-text("Потвърди анулирането")');assert(await p.locator('.pill:has-text("Анулирана")').count()===0);await p.click('[data-act=void]');await p.waitForSelector('.note.good:has-text("анулирана")');assert.equal(await p.locator('[data-act=reopen-inv]').count(),0);ok('#10 voiding asks for confirmation and a voided invoice cannot be reopened');
  /* №14 */
  await p.click('#nav a:has-text("Плащания")');await p.waitForSelector('[data-act=new][data-type=bill]');await p.focus('[data-act=new][data-type=bill]');await p.evaluate(()=>{window.__renders=0;new MutationObserver(()=>window.__renders++).observe(document.getElementById('main'),{childList:true})});
  await p.waitForTimeout(21500);assert.deepEqual(await p.evaluate(()=>[window.__renders,document.activeElement.dataset.act,document.getElementById('main').getAttribute('aria-live')]),[0,'new',null]);ok('#14 the 20-second refresh leaves the page and keyboard focus alone when nothing changed');
  /* опресняване, по време на което данните се сменят и потребителят мести фокуса: фокусът остава при потребителя */
  await p.evaluate(()=>{const f=window.fetch;window.fetch=async(u,o)=>{const slow=String(u).includes('/api/fin/state')&&window.__slow;if(slow){window.__slow=false;window.__inflight=true}const r=await f(u,o);if(slow){await new Promise(z=>setTimeout(z,1500));window.__done=true}return r}});
  await p.focus('[data-act=new][data-type=bill]');await p.evaluate(()=>{window.__slow=true});
  assert.equal((await p.request.post(B+'/api/fin/items',{headers:{'x-fb':'1'},data:{type:'bill',data:{party:'Нов доставчик ЕООД',date:'2026-11-03',amount:42}}})).status(),200);
  await p.waitForFunction(()=>window.__inflight,null,{timeout:25000});await p.focus('#nav a[data-view=invoice]');
  await p.waitForFunction(()=>window.__done,null,{timeout:5000});await p.waitForSelector('tr:has-text("Нов доставчик ЕООД")');
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.view),'invoice');ok('#14 when the data changes during a refresh, keyboard focus stays where the user moved it');
  assert.deepEqual(errs,[]);console.log('E2E forms: all '+n+' steps passed');
  }finally{await br.close();srv.stop()}
})().catch(e=>{console.error('E2E forms FAIL after step '+n+':',e.message);process.exit(1)});
