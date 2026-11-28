/* QR код при настройка на двуфакторния вход и шифроване на ключа му с TOTP_KEY от средата. */
const assert=require('node:assert'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{DatabaseSync}=require('node:sqlite');const H=require('./helpers');const QR=require('../qr');
const PW='parola-parola-1';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const dec=s=>{let bits='';for(const c of s)bits+=B32.indexOf(c).toString(2).padStart(5,'0');const o=[];for(let i=0;i+8<=bits.length;i+=8)o.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(o)};
const totp=(secret,step)=>{step=step==null?Math.floor(Date.now()/30000):step;const c=Buffer.alloc(8);c.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',dec(secret)).update(c).digest(),o=h[19]&15;return String(((h[o]&127)<<24|h[o+1]<<16|h[o+2]<<8|h[o+3])%1e6).padStart(6,'0')};
const K1='proben-klyuch-za-testa-1',dir=fs.mkdtempSync(path.join(os.tmpdir(),'fb-totp-'));
const row=email=>{const db=new DatabaseSync(path.join(dir,'finbridge.db'),{timeout:5000});try{return db.prepare('SELECT id,totp,totp_pending FROM users WHERE email=?').get(email)}finally{db.close()}};
const run=async(port,env,fn)=>{const srv=await H.startServer(port,{DATA_DIR:dir,...env});try{await fn(port)}finally{srv.stop();await H.sleep(400)}};
(async()=>{
  let secret,step;
  await run(9031,{TOTP_KEY:K1},async P=>{
    const A=H.client(P);await A('POST','/api/register',{office:'Фирма А',email:'a@a.test',password:PW,kind:'company'});
    await H.client(P)('POST','/api/register',{office:'Фирма Б',email:'b@b.test',password:PW,kind:'company'});
    await H.client(P)('POST','/api/register',{office:'Фирма В',email:'v@v.test',password:PW,kind:'company'});
    const r=await A('POST','/api/2fa/setup',{password:PW});assert.equal(r.status,200);secret=r.json.secret;
    assert(r.json.qr.startsWith('data:image/svg+xml;base64,'));const svg=Buffer.from(r.json.qr.split(',')[1],'base64').toString();
    assert.equal(svg,QR.svg(r.json.uri),'кодът носи същата връзка otpauth');assert(/^<svg [^>]*viewBox="0 0 \d+ \d+"/.test(svg));
    ok('setup returns a QR code with the same otpauth link as the key');
    const p=row('a@a.test').totp_pending;assert(p.startsWith('enc1:')&&!p.includes(secret),'ключът в базата е шифрован');
    step=Math.floor(Date.now()/30000);assert.equal((await A('POST','/api/2fa/enable',{code:totp(secret,step)})).status,200);
    const t=row('a@a.test').totp;assert(t.startsWith('enc1:')&&!t.includes(secret));
    ok('with TOTP_KEY the key is stored encrypted, both while pending and once enabled');
  });
  /* ключ от стара версия, записан в явен вид */
  const old=b=>{const db=new DatabaseSync(path.join(dir,'finbridge.db'),{timeout:5000});db.prepare("UPDATE users SET totp=?,totp_step=0,recovery='[]' WHERE email='b@b.test'").run(b);db.close()},plain='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';old(plain);
  await run(9032,{TOTP_KEY:K1},async P=>{
    const b=row('b@b.test').totp;assert(b.startsWith('enc1:')&&!b.includes(plain),'старият ключ е шифрован при пускане');
    assert.equal((await H.client(P)('POST','/api/login',{email:'b@b.test',password:PW,code:totp(plain)})).status,200);
    assert.equal((await H.client(P)('POST','/api/login',{email:'a@a.test',password:PW,code:totp(secret,step+1)})).status,200);
    ok('on start-up a plain key from an older version is encrypted, and both users still sign in with their codes');
  });
  for(const [P,env,what] of [[9033,{TOTP_KEY:'drug-klyuch'},'a wrong TOTP_KEY'],[9034,{},'no TOTP_KEY']])await run(P,env,async P=>{
    const r=await H.client(P)('POST','/api/login',{email:'b@b.test',password:PW,code:totp(plain)});assert.equal(r.status,503);assert.equal(r.json.error,'totp_key');assert(r.json.message.includes('TOTP_KEY'));
    assert.equal((await H.client(P)('POST','/api/login',{email:'v@v.test',password:PW})).status,200,'без двуфакторен вход влиза');
    ok('with '+what+' a 2FA user gets a clear 503, the others sign in as usual');
  });
  console.log('TOTP key: all '+n+' checks passed');
})().catch(e=>{console.error('TOTP key FAIL after check '+n+':',e);process.exit(1)});
