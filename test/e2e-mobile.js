const {chromium}=require(process.env.PLAYWRIGHT||'/opt/npm-tools/node_modules/playwright');const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path');const H=require('./helpers');
const B='http://127.0.0.1:8891',FX=f=>path.join(__dirname,'fixtures',f);let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);const PW='dostatachno-dalga';
const J=o=>'```json\n'+JSON.stringify(o)+'\n```';
(async()=>{
  const ai=await H.mockAI(8894,j=>{const c=j.messages[0].content[0];
    if(c.type==='document')return{text:J({docType:'invoice',supplier:'Гориво Плюс АД',number:'1000000414',date:'2026-10-05',due:'2026-11-04',currency:'EUR',total:132.6,vat:22.1,category:'Гориво и транспорт',subject:'Дизелово гориво',confidence:.95,notes:''})};
    return{text:J({docType:'receipt',supplier:'Шел България',number:'',date:'2026-11-03',due:null,currency:'EUR',total:'41,20',vat:6.87,category:'Гориво и транспорт',subject:'Дизел',confidence:.9,notes:''})}});
  const srv=await H.startServer(8891,{ANTHROPIC_API_KEY:'k',ANTHROPIC_BASE_URL:'http://127.0.0.1:8894'});const b=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome'});
  try{
  const errs=[];
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});
  await p.goto(B+'/login');await p.click('#swap');await p.selectOption('#kind','company');await p.fill('#office','Варна Строй ООД');await p.fill('#email','shef@firma.test');await p.fill('#password',PW);await p.click('#go');await p.waitForSelector('h1:has-text("Табло")');
  const overflow=async()=>p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  for(const v of ['Табло','Разходи','Плащания','Вземания','Бюджети','Екип и правила']){await p.click('#nav a:has-text("'+v+'")');await p.waitForTimeout(250);assert(await overflow()<=1,'хоризонтално разливане в '+v+': '+await overflow())}
  ok('mobile 390 px: no horizontal overflow in any of the six sections');
  assert(await p.locator('#snap').isVisible());const bb=await p.locator('#snap').boundingBox();assert(bb.height>=44&&bb.y+bb.height<=844);
  await p.click('#nav a:has-text("Разходи")');await p.click('[data-act=new][data-type=expense]');
  const fz=await p.locator('#item-form input[name=party]').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));assert(fz>=16,'малък шрифт '+fz);assert(await p.locator('#snap').evaluate(e=>e.classList.contains('off')));await p.click('[data-act=cancel]');
  ok('the camera button is in thumb reach, hides while a form is open, and inputs are 16 px or larger so phones do not zoom');

  // снимка от камерата
  await p.setInputFiles('#snap-file',FX('scan-receipt.png'));await p.waitForSelector('#scan-out .scan:has-text("Разчетено автоматично")');
  assert.deepEqual(await p.evaluate(()=>{const f=document.getElementById('item-form').elements;return [f.party.value,f.date.value,f.amount.value,f.cat.value,f.note.value]}),['Шел България','2026-11-03','41,20','Гориво и транспорт','Дизел']);
  assert((await p.locator('#scan-out').innerText()).includes('увереност 90%'));
  await p.click('#item-form button[type=submit]');await p.waitForSelector('.note.good:has-text("Добавено")');
  assert((await p.locator('#main').innerText()).includes('Шел България'));assert.equal(await p.locator('a:has-text("Документ")').count(),1);
  assert.equal(await p.evaluate(async()=>{const h=document.querySelector('a[href*="/file"]').href;return (await fetch(h)).headers.get('content-type')}),'image/png','оригиналът се пази непроменен');
  ok('photo from the camera button: the form opens already filled, the user confirms, and the picture is attached to the expense');

  // втори път същият документ: предупреждение
  await p.setInputFiles('#snap-file',FX('scan-receipt.png'));await p.waitForSelector('#scan-out .warn:has-text("вече е въведен")');await p.click('[data-act=cancel]');
  ok('the same receipt again shows the duplicate warning');

  // PDF от формата за фактури на десктоп размер
  await p.setViewportSize({width:1280,height:900});await p.click('#nav a:has-text("Плащания")');await p.click('[data-act=new][data-type=bill]');
  await p.setInputFiles('#item-form input[name=file]',FX('faktura_gorivo.pdf'));await p.waitForSelector('#scan-out .scan:has-text("Разчетено автоматично")');
  assert.deepEqual(await p.evaluate(()=>{const f=document.getElementById('item-form').elements;return [f.party.value,f.number.value,f.date.value,f.due.value,f.amount.value]}),['Гориво Плюс АД','1000000414','2026-10-05','2026-11-04','132,60']);
  await p.fill('#item-form input[name=note]','Проверена');await p.click('#item-form button[type=submit]');await p.waitForSelector('.note.good:has-text("Добавено")');assert((await p.locator('#main').innerText()).includes('Гориво Плюс АД'));
  ok('PDF invoice in the supplier form: fields, due date and category are filled; the person can still edit before saving');

  // сменен документ и изчистване
  await p.click('[data-act=new][data-type=bill]');await p.setInputFiles('#item-form input[name=file]',FX('scan-receipt.png'));await p.waitForSelector('#scan-out .scan:has-text("касова бележка")');
  await p.setInputFiles('#item-form input[name=file]',[]);await p.waitForFunction(()=>!document.getElementById('scan-out').innerText);
  ok('a receipt in the supplier form hints at the right section; clearing the file clears the result');
  assert.deepEqual(errs,[],'грешки в конзолата: '+errs.join('|'));ok('no JavaScript errors in the console');
  console.log('\n'+n+' passed');
  }finally{await b.close();srv.stop();ai.close()}
})().catch(e=>{console.error(e);process.exit(1)});
