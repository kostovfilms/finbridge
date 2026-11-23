const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');const H=require('./helpers');
let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);const PW='parola-parola-1',PNG=fs.readFileSync(path.join(__dirname,'fixtures','scan-receipt.png'));
const run=(script,args,env)=>spawnSync(process.execPath,['--no-warnings',path.join(__dirname,'..','scripts',script),...args],{env:{...process.env,...env},encoding:'utf8'});
(async()=>{
  const A=await H.startServer(8931,{});let B2;
  try{
  const jc=B=>{let cookie='';return async(method,url,body)=>{const h={'x-fb':'1'};if(cookie)h.cookie=cookie;let b=body;if(body&&!Buffer.isBuffer(body)){b=JSON.stringify(body);h['content-type']='application/json'}
    const r=await fetch(B+url,{method,headers:h,body:b});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const ab=Buffer.from(await r.arrayBuffer()),ct=r.headers.get('content-type')||'';return{status:r.status,buf:ab,ct,body:ct.includes('json')?JSON.parse(ab.toString()):ab.toString()}}};
  const c=jc('http://127.0.0.1:8931');
  assert.equal((await c('POST','/api/register',{office:'Варна Строй ООД',email:'shef@firma.test',password:PW,kind:'company'})).status,200);
  await c('PUT','/api/fin/settings',{data:{balance:100,cats:[],seller:{eik:'489280014',address:'София',mol:'Мария'}}});
  const ex=(await c('POST','/api/fin/items',{type:'expense',data:{party:'Шел',date:'2026-11-03',amount:'41,20',pay:'own'}})).body;assert.equal((await c('POST','/api/fin/items/'+ex.id+'/file?name=bon.png',PNG)).status,200);
  const inv=(await c('POST','/api/fin/invoices',{data:{party:'Клиент',eik:'507081376',rate:0,vatNote:'чл. 113',lines:[{name:'Услуга',qty:1,price:100}]}})).body;
  assert.equal((await c('POST','/api/fin/invoices/'+inv.id+'/credit',{data:{reason:'Отстъпка',lines:[{name:'Услуга',qty:1,price:10}]}})).status,200);
  const before=(await c('GET','/api/fin/state')).body;

  /* копие при работещ сървър */
  const snap=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'snap-')),'s1');
  let r=run('snapshot.js',[snap],{DATA_DIR:A.dir});assert.equal(r.status,0,r.stderr+r.stdout);
  const mf=JSON.parse(fs.readFileSync(path.join(snap,'manifest.json')));assert.deepEqual([mf.app,mf.format,Object.keys(mf.files).length,mf.counts.fin,mf.counts.users],['finbridge',1,1,3,1]);
  assert.equal(run('snapshot.js',[snap],{DATA_DIR:A.dir}).status,1,'не презаписва съществуващо копие');
  ok('a snapshot of the running server: consistent database copy, documents, manifest with checksums and counts; it never overwrites an earlier snapshot');

  /* възстановяване в нова папка и пускане на сървър от нея */
  const target=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rest-')),'data');
  r=run('restore.js',[snap],{DATA_DIR:target});assert.equal(r.status,0,r.stderr+r.stdout);assert(r.stdout.includes('fin=3'));
  B2=await H.startServer(8932,{DATA_DIR:target});const c2=jc('http://127.0.0.1:8932');
  assert.equal((await c2('POST','/api/login',{email:'shef@firma.test',password:PW})).status,200,'паролата работи след възстановяване');
  const after=(await c2('GET','/api/fin/state')).body;
  const norm=s=>JSON.stringify({items:s.items.map(i=>[i.id,i.type,i.status,i.amount,i.number,i.credited,i.credits.length,i.refund]).sort(),settings:s.settings,firm:s.firm});assert.equal(norm(after),norm(before));
  const f1=await c('GET','/api/fin/items/'+ex.id+'/file'),f2=await c2('GET','/api/fin/items/'+ex.id+'/file');assert.equal(f2.status,200);assert(Buffer.compare(f1.buf,f2.buf)===0&&Buffer.compare(f2.buf,PNG)===0);
  ok('restored into a new folder: the same login works, items, credit notes, settings and the attached document are identical');

  /* защити */
  assert.equal(run('restore.js',[snap],{DATA_DIR:target}).status,1);assert(fs.existsSync(path.join(target,'finbridge.db')));
  r=run('restore.js',[snap,'--force'],{DATA_DIR:target});assert.equal(r.status,0,r.stderr);const aside=fs.readdirSync(path.dirname(target)).filter(x=>x.startsWith('data.before-restore-'));assert.equal(aside.length,1);assert(fs.existsSync(path.join(path.dirname(target),aside[0],'finbridge.db')));
  ok('restoring onto existing data is refused; with --force the old data is moved aside, never deleted');
  const bad=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'bad-')),'s');fs.cpSync(snap,bad,{recursive:true});fs.appendFileSync(path.join(bad,'finbridge.db'),'x');
  const t3=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rest3-')),'data');r=run('restore.js',[bad],{DATA_DIR:t3});assert.equal(r.status,1);assert(r.stderr.includes('повредена'));assert(!fs.existsSync(t3));
  const bad2=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'bad2-')),'s');fs.cpSync(snap,bad2,{recursive:true});const fn=Object.keys(mf.files)[0];fs.writeFileSync(path.join(bad2,'files',fn),'подменен');
  r=run('restore.js',[bad2],{DATA_DIR:t3});assert.equal(r.status,1);assert(r.stderr.includes('документи'));assert(!fs.existsSync(t3));assert.equal(run('restore.js',[path.dirname(bad)],{DATA_DIR:t3}).status,1);
  ok('a tampered database or document, or a folder that is not a snapshot, is detected before anything is written');
  console.log('\n'+n+' passed');
  }finally{A.stop();if(B2)B2.stop()}
})().catch(e=>{console.error(e);process.exit(1)});
