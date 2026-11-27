/* Браузър: страница „Сигурност“, двуфакторен вход, журнал, изпращане на фактура по имейл; без грешки при строгата CSP. */
const {chromium}=require(process.env.PLAYWRIGHT||'/opt/npm-tools/node_modules/playwright');const assert=require('node:assert'),crypto=require('node:crypto');const H=require('./helpers');
const B='http://127.0.0.1:8913';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);const PW='dostatachno-dalga';
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const dec=s=>{let bits=0,val=0;const out=[];for(const c of s.replace(/[^A-Z2-7]/g,'')){val=(val<<5)|B32.indexOf(c);bits+=5;if(bits>=8){out.push((val>>>(bits-8))&255);bits-=8}}return Buffer.from(out)};
const totp=(secret,step)=>{const m=Buffer.alloc(8);m.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',dec(secret)).update(m).digest(),o=h[h.length-1]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,'0')};
const stepNow=()=>Math.floor(Date.now()/30000);
(async()=>{
  const smtp=await H.fakeSMTP(2539);
  const srv=await H.startServer(8913,{SMTP_HOST:'127.0.0.1',SMTP_PORT:'2539',SMTP_SECURE:'false',SMTP_FROM:'no-reply@finbridge.test'});const b=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome'});
  try{
  const errs=[];const ctx=await b.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});
  await p.goto(B+'/login');await p.click('#swap');await p.selectOption('#kind','company');await p.fill('#office','Варна Строй ООД');await p.fill('#email','shef@firma.test');await p.fill('#password',PW);await p.click('#go');await p.waitForSelector('h1:has-text("Табло")');
  await p.click('#foot a:has-text("Сигурност и журнал")');await p.waitForSelector('#tf-start');
  assert((await p.locator('#who').innerText()).includes('shef@firma.test'));
  await p.click('#tf-start');await p.waitForSelector('#tf-setup:not([hidden])');const secret=(await p.locator('#tf-secret').innerText()).replace(/\s/g,'');assert.match(secret,/^[A-Z2-7]{32}$/);
  assert((await p.locator('#tf-uri').getAttribute('href')).startsWith('otpauth://totp/'));
  await p.fill('#tf-code','000000');await p.click('#tf-enable button');await p.waitForSelector('#tf-msg.err');
  await p.fill('#tf-code',totp(secret,stepNow()));await p.click('#tf-enable button');await p.waitForSelector('#tf-on:not([hidden])');
  ok('owner opens "Security" from the app, sets up two-factor login with the key shown, a wrong code is refused, the right one turns it on');
  const p2=await (await b.newContext()).newPage();p2.on('pageerror',e=>errs.push(e.message));
  await p2.goto(B+'/login');await p2.fill('#email','shef@firma.test');await p2.fill('#password',PW);await p2.click('#go');await p2.waitForSelector('#code-row:not([hidden])');
  assert((await p2.locator('#err').innerText()).includes('6-цифрения код'));
  await p2.fill('#code',totp(secret,stepNow()+1));await p2.click('#go');await p2.waitForSelector('h1:has-text("Табло")');
  ok('logging in on another browser asks for the code after the password and lets the person in with it');
  await p.reload();await p.waitForSelector('#rows tr');const log=await p.locator('#rows').innerText();assert(log.includes('Включен двуфакторен вход')&&log.includes('Вход'),log);
  ok('the audit log on the same page lists the login and the two-factor change');
  await p.goto(B+'/');await p.waitForSelector('h1:has-text("Табло")');
  await p.click('#nav a:has-text("Екип и правила")');await p.waitForSelector('#set-form');await p.fill('[name=s_eik]','489280014');await p.fill('[name=s_mol]','Мария Петрова');await p.fill('[name=s_address]','София, бул. Витоша 5');await p.click('#set-form button[type=submit]');await p.waitForSelector('.note.good');
  await p.click('#nav a:has-text("Вземания")');await p.click('[data-act=issue]');await p.fill('#issue-form [name=party]','Клиент ООД');await p.fill('#issue-form [name=l_name]','Консултация');await p.fill('#issue-form [name=l_price]','100');await p.fill('#issue-form [name=l_qty]','3');await p.click('#issue-form button[type=submit]');await p.waitForSelector('#invoice-doc');
  await p.click('[data-act=mail-open]');await p.fill('#mail-form [name=to]','klient@example.test');await p.fill('#mail-form [name=message]','Здравейте!');await p.click('#mail-form button[type=submit]');
  await p.waitForSelector('.note:has-text("Изпратена до klient@example.test")');assert.equal(smtp.mails.length,1);assert(smtp.mails[0].cmds.includes('RCPT TO:<klient@example.test>'));
  await p.click('[data-act=mail-open]');assert.equal(await p.locator('#mail-form [name=to]').inputValue(),'klient@example.test','адресът се помни');
  ok('an issued invoice is sent by e-mail from its page; the page shows where it went and remembers the address');
  assert.deepEqual(errs,[]);ok('no JavaScript or CSP errors');
  console.log('E2E security: all '+n+' steps passed');
  }finally{await b.close();srv.stop();smtp.close()}
})().catch(e=>{console.error('E2E security FAIL after step '+n+':',(e.stack||e.message||'').slice(0,1500));process.exit(1)});
