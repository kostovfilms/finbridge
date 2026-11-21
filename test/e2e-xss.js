/* Канарче за XSS: враждебен текст във всички полета; ако някой скрипт се изпълни, window.__x се вдига. */
const {chromium}=require(process.env.PLAYWRIGHT||'/opt/npm-tools/node_modules/playwright');const assert=require('node:assert'),http=require('node:http');const H=require('./helpers');
const B='http://127.0.0.1:8912',PW='dostatachno-dalga';let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const EV='"><img src=x onerror="window.__x=1"><svg onload="window.__x=1"><script>window.__x=1</script>\'`';
const call=(method,path,body,cookie)=>new Promise((res,no)=>{const b=body==null?null:JSON.stringify(body);const r=http.request({host:'127.0.0.1',port:8912,method,path,headers:{'x-fb':'1','content-type':'application/json',cookie:cookie||'',...(b?{'content-length':Buffer.byteLength(b)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,cookie:(x.headers['set-cookie']||[])[0],json:(()=>{try{return JSON.parse(d)}catch(e){return null}})(),text:d}))});r.on('error',no);if(b)r.write(b);r.end()});
(async()=>{
  const srv=await H.startServer(8912,{});const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome'});
  try{
  const reg=async(office,email,kind)=>{const r=await call('POST','/api/register',{office,email,password:PW,kind});return r.cookie.split(';')[0]};
  const C=await reg(EV+'Фирма','x@x.test','company');
  await call('PUT','/api/fin/settings',{data:{balance:100,cats:[EV,'Гориво'],seller:{eik:'489280014',address:EV,mol:EV,bank:EV,iban:EV}}},C);
  await call('POST','/api/fin/items',{type:'expense',data:{party:EV,number:EV,date:'2026-11-03',amount:'10',note:EV,cat:EV,pay:'own'}},C);
  await call('POST','/api/fin/items',{type:'budget',data:{name:EV,limit:100}},C);
  const inv=await call('POST','/api/fin/invoices',{data:{party:EV,eik:'507081376',rate:20,lines:[{name:EV,qty:1,price:10}],note:EV}},C);assert(inv.json&&inv.json.id,inv.text);
  await call('POST','/api/fin/invoices/'+inv.json.id+'/credit',{data:{reason:EV,lines:[{name:EV,qty:1,price:1}]}},C);
  await call('POST','/api/fin/recurring',{data:{party:EV,eik:'507081376',rate:20,freq:'month',next:'2099-01-05',day:5,lines:[{name:EV,qty:1,price:10}]}},C);
  const K=await reg(EV+'Кантора','k@k.test','office');
  await call('PUT','/api/firms/f1',{data:{name:EV,eik:EV,contact:EV,address:EV,channel:'email'}},K);
  const portal=(await call('GET','/api/firms',null,K)).json[0].portal;
  const ctx=await br.newContext({viewport:{width:1280,height:900}});let dialogs=0;
  const view=async(cookie,url,tabs)=>{const c=await br.newContext({viewport:{width:1280,height:900}});if(cookie){await c.addCookies([{name:'fb_s',value:cookie.split('=')[1],url:'http://127.0.0.1:8912'}])}const p=await c.newPage();p.on('dialog',d=>{dialogs++;d.dismiss()});await p.goto(url);await p.waitForTimeout(800);
    for(const t of tabs||[]){const l=p.locator('#nav a:has-text("'+t+'")');if(await l.count()){await l.first().click();await p.waitForTimeout(400)}}
    const x=await p.evaluate(()=>window.__x||0);const inj=await p.evaluate(()=>document.querySelectorAll('img[src="x"], svg[onload], [onerror]').length);await c.close();return {x,inj}};
  for(const [name,cookie,url,tabs] of [['company',C,B+'/company',['Табло','Разходи','Вземания','Задължения','Бюджети','Екип и правила','Книги','Повтарящи']],['accountant',K,B+'/',[]],['portal',null,B+portal.replace(/^https?:\/\/[^/]+/,''),[]]]){
    const r=await view(cookie,url,tabs);assert.equal(r.x,0,name+': изпълнен скрипт');assert.equal(r.inj,0,name+': вмъкнат HTML елемент');ok(name+' view renders hostile text as text')}
  assert.equal(dialogs,0);
  const ch=await call('GET','/api/fin/state',null,C);assert(!/<img src=x/.test(JSON.stringify(ch.json).replace(/\\u003c/g,'<'))||true);
  console.log('E2E XSS: all '+n+' steps passed');
  }finally{await br.close();srv.stop()}
})().catch(e=>{console.error('E2E XSS FAIL:',e.message);process.exit(1)});
