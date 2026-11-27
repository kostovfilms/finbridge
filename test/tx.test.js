/* Операции от няколко записа минават изцяло или изобщо не. Грешката се предизвиква с тригер в базата, който спира последната стъпка. */
const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');const H=require('./helpers');
const PW='parola-parola-1',P=9021;let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
const pdf=Buffer.from('%PDF-1.4\n% проба\n');
(async()=>{
  const srv=await H.startServer(P,{});const db=new DatabaseSync(path.join(srv.dir,'finbridge.db'));db.exec('PRAGMA busy_timeout=5000');
  const stop=sql=>db.exec(sql),go=name=>db.exec('DROP TRIGGER '+name),count=(sql,...a)=>db.prepare(sql).get(...a).n;
  const onDisk=()=>fs.readdirSync(path.join(srv.dir,'files')).length;
  try{
  /* кантора с фирма, файл, месец и колега */
  const A=H.client(P);assert.equal((await A('POST','/api/register',{office:'Кантора Т',email:'t@t.test',password:PW})).status,200);
  assert.equal((await A('PUT','/api/firms/f1',{data:{name:'Клиент 1'}})).status,200);
  assert.equal((await A('POST','/api/files?firm=f1&name=a.pdf',pdf)).status,200);
  assert.equal((await A('PUT','/api/period/f1/2026-10',{data:{txs:[{id:'t1',date:'2026-10-03',amount:-10,cp:'X'}],docs:[]}})).status,200);
  const O=db.prepare("SELECT office_id AS o FROM users WHERE email='t@t.test'").get().o;

  stop("CREATE TRIGGER no_firm_del BEFORE DELETE ON firms BEGIN SELECT RAISE(ABORT,'проба'); END");
  assert.equal((await A('DELETE','/api/firms/f1')).status,500);go('no_firm_del');
  assert.deepEqual([count('SELECT COUNT(*) AS n FROM files WHERE office_id=?',O),count('SELECT COUNT(*) AS n FROM periods WHERE office_id=?',O),onDisk()],[1,1,1]);
  ok('a failed firm delete leaves its files, months and stored documents in place');

  assert.equal((await A('POST','/api/users',{email:'k@t.test',password:PW})).status,200);const K=H.client(P);await K('POST','/api/login',{email:'k@t.test',password:PW});
  const kid=db.prepare("SELECT id FROM users WHERE email='k@t.test'").get().id;
  stop("CREATE TRIGGER no_user_del BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT,'проба'); END");
  assert.equal((await A('DELETE','/api/users/'+kid)).status,500);go('no_user_del');
  assert.equal((await K('GET','/api/me')).status,200,'сесията на колегата остава');
  ok('a failed colleague removal does not end the colleague\'s sessions halfway');

  const offices=count('SELECT COUNT(*) AS n FROM offices');
  stop("CREATE TRIGGER no_user_ins BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT,'проба'); END");
  assert.equal((await H.client(P)('POST','/api/register',{office:'Половин',email:'h@h.test',password:PW,kind:'company'})).status,500);go('no_user_ins');
  assert.deepEqual([count('SELECT COUNT(*) AS n FROM offices'),count("SELECT COUNT(*) AS n FROM firms WHERE data LIKE '%Половин%'")],[offices,0]);
  assert.equal((await H.client(P)('POST','/api/register',{office:'Половин',email:'h@h.test',password:PW,kind:'company'})).status,200,'и после се регистрира нормално');
  ok('a failed sign-up leaves no office or company without an owner');

  /* фирма: издаване на фактура и документ към разход */
  const C=H.client(P);await C('POST','/api/register',{office:'Фирма Т ЕООД',email:'c@c.test',password:PW,kind:'company'});
  assert.equal((await C('PUT','/api/fin/settings',{data:{cats:['Други'],seller:{eik:'507081376',address:'София',mol:'Иван Петров'}}})).status,200);
  const F=db.prepare("SELECT firm_id AS f FROM users WHERE email='c@c.test'").get().f;
  stop("CREATE TRIGGER no_numbering BEFORE INSERT ON finset BEGIN SELECT RAISE(ABORT,'проба'); END");
  let r=await C('POST','/api/fin/invoices',{data:{party:'Купувач ООД',lines:[{name:'Услуга',qty:1,price:100}]}});assert.equal(r.status,500);go('no_numbering');
  assert.equal(count("SELECT COUNT(*) AS n FROM fin WHERE firm_id=? AND type='invoice'",F),0,'без фактура, за която броячът не е преместен');
  r=await C('POST','/api/fin/invoices',{data:{party:'Купувач ООД',lines:[{name:'Услуга',qty:1,price:100}]}});assert.equal(r.status,200);assert.equal(r.json.number,'0000000001');
  ok('an invoice is not stored when the number counter cannot move, so numbers stay in order');

  r=await C('POST','/api/fin/items',{type:'expense',data:{party:'Магазин',date:'2026-11-02',amount:12.5}});const eid=r.json.id;const disk=onDisk(),rows=count('SELECT COUNT(*) AS n FROM files');
  stop("CREATE TRIGGER no_fin_upd BEFORE UPDATE ON fin BEGIN SELECT RAISE(ABORT,'проба'); END");
  assert.equal((await C('POST','/api/fin/items/'+eid+'/file?name=b.pdf',pdf)).status,500);go('no_fin_upd');
  assert.deepEqual([count('SELECT COUNT(*) AS n FROM files'),onDisk()],[rows,disk]);
  ok('a document that cannot be attached leaves no stray file row and no stray file on disk');

  stop("CREATE TRIGGER no_fin_del BEFORE DELETE ON fin BEGIN SELECT RAISE(ABORT,'проба'); END");
  assert.equal((await C('POST','/api/fin/items/'+eid+'/file?name=b.pdf',pdf)).status,200);const d2=onDisk();
  assert.equal((await C('DELETE','/api/fin/items/'+eid)).status,500);go('no_fin_del');
  assert.equal(onDisk(),d2,'документът на диска остава');assert.equal((await C('GET','/api/fin/items/'+eid+'/file')).status,200);
  assert.equal((await C('DELETE','/api/fin/items/'+eid)).status,200);assert.equal(onDisk(),d2-1,'и се маха, когато изтриването мине');
  ok('a failed expense delete keeps its document; a successful one removes it');
  console.log('TX: all '+n+' checks passed');
  }finally{db.close();srv.stop()}
})().catch(e=>{console.error('TX FAIL after check '+n+':',e);process.exit(1)});
