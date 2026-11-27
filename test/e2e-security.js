/* Двуфакторен вход и журнал през истински браузър. */
const {chromium}=require(process.env.PLAYWRIGHT||'/opt/npm-tools/node_modules/playwright');const assert=require('node:assert'),crypto=require('node:crypto');const H=require('./helpers');
const B='http://127.0.0.1:8961',PW='dostatachno-dalga';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const dec=s=>{let bits='';for(const c of s)bits+=B32.indexOf(c).toString(2).padStart(5,'0');const o=[];for(let i=0;i+8<=bits.length;i+=8)o.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(o)};
const totp=(secret,step)=>{const c=Buffer.alloc(8);c.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',dec(secret)).update(c).digest(),o=h[19]&15;return String(((h[o]&127)<<24|h[o+1]<<16|h[o+2]<<8|h[o+3])%1e6).padStart(6,'0')};
(async()=>{
  const srv=await H.startServer(8961,{});const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--enable-experimental-web-platform-features']});
  try{
  const errs=[];const ctx=await br.newContext({viewport:{width:390,height:800}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});
  await p.goto(B+'/login');await p.click('#swap');await p.selectOption('#kind','company');await p.fill('#office','Варна Строй ООД');await p.fill('#email','shef@firma.test');await p.fill('#password',PW);await p.click('#go');await p.waitForSelector('#foot a[href="/security"]');
  await p.click('#foot a[href="/security"]');await p.waitForSelector('#f-setup:visible');assert.equal(await p.locator('#state').innerText(),'изключен');
  await p.fill('#pw1','greshna-parola');await p.click('#f-setup button[type=submit]');await p.waitForSelector('#e-setup:has-text("Паролата не е вярна")');
  await p.fill('#pw1',PW);await p.click('#f-setup button[type=submit]');await p.waitForSelector('#setup:visible');const secret=await p.locator('#secret').getAttribute('data-raw');assert(/^[A-Z2-7]{32}$/.test(secret));assert((await p.locator('#uri').getAttribute('href')).startsWith('otpauth://totp/'));ok('setup shows the key after the password is confirmed');
  /* QR кодът се разчита с вградения четец на Chrome (на macOS и Android). Където го няма (Linux в CI), стъпката се отбелязва като пропусната. */
  assert(await p.locator('#qr').isVisible());const read=src=>p.evaluate(async src=>{const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas'),k=Math.max(4,Math.ceil(800/img.naturalWidth));c.width=c.height=img.naturalWidth*k;const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(img,0,0,c.width,c.height);return (await new BarcodeDetector({formats:['qr_code']}).detect(c)).map(z=>z.rawValue)},src);
  if(await p.evaluate(()=>typeof BarcodeDetector!=='undefined')){
    assert.deepEqual(await read(await p.locator('#qr').getAttribute('src')),[await p.locator('#uri').getAttribute('href')]);
    const QR=require('../qr');for(const t of ['A','Кантора „Иванов“ ЕООД'].concat([60,150,300,700,1200,2300].map(k=>Array.from({length:k},(x,i)=>String.fromCharCode(33+(i*7)%90)).join(''))))
      assert.deepEqual(await read('data:image/svg+xml;base64,'+Buffer.from(QR.svg(t)).toString('base64')),[t],'версия '+((QR.matrix(t).length-17)/4));
    ok('the QR code on the page scans to the same otpauth link; codes of versions 1 to 40 scan back to their text');
  } else console.log('skip   QR: този Chrome няма вграден четец на QR кодове');
  await p.fill('#code1','000000');await p.click('#f-enable button[type=submit]');await p.waitForSelector('#e-enable:has-text("Кодът не е верен")');
  const st=Math.floor(Date.now()/30000);await p.fill('#code1',totp(secret,st));await p.click('#f-enable button[type=submit]');await p.waitForSelector('#codes:visible');const codes=await p.locator('#list code').allInnerTexts();assert.equal(codes.length,8);
  await p.click('#saved');await p.waitForSelector('#on:visible');assert.equal(await p.locator('#state').innerText(),'включен');assert((await p.locator('#left').innerText()).includes('8 резервни'));ok('a wrong code is refused; the right one enables 2FA and shows 8 recovery codes once');
  await p.waitForSelector('#rows tr:has-text("Включен двуфакторен вход")');assert(await p.locator('#rows tr:has-text("Регистрация")').count());const w=await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);assert(w,'страницата излиза извън екрана на телефон');ok('the owner sees the action log on a phone-sized screen');
  await ctx.clearCookies();await p.goto(B+'/login');await p.fill('#email','shef@firma.test');await p.fill('#password',PW);assert(await p.locator('#code-row').isHidden());await p.click('#go');await p.waitForSelector('#code-row:visible');assert((await p.locator('#err').innerText()).includes('Въведете кода'));
  await p.fill('#code','111111');await p.click('#go');await p.waitForSelector('#err:has-text("Кодът не е верен")');await p.fill('#code',codes[0]);await p.click('#go');await p.waitForSelector('h1:has-text("Табло")');ok('sign-in asks for the code only after the password and accepts a recovery code');
  await p.goto(B+'/security');await p.waitForSelector('#rows tr:has-text("с резервен код")');assert((await p.locator('#left').innerText()).includes('7 резервни'));await p.waitForSelector('#rows tr:has-text("Неуспешен вход")');
  await p.fill('#pw2',PW);await p.fill('#code2',codes[1]);await p.click('#f-disable button[type=submit]');await p.waitForSelector('#f-setup:visible');assert.equal(await p.locator('#state').innerText(),'изключен');ok('the log shows the recovery sign-in and the failed attempt; 2FA can be turned off with password and code');
  assert.deepEqual(errs,[]);console.log('E2E security: all '+n+' steps passed');
  }finally{await br.close();srv.stop()}
})().catch(e=>{console.error('E2E security FAIL after step '+n+':',e.message);process.exit(1)});
