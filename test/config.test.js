/* Настройки за качване и CI: Render не качва сам, CI пуска и двата набора тестове, всеки тестов файл е в набора си. */
const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');let n=0;const ok=m=>console.log('ok   '+(++n)+'. '+m);
/* редовете без коментарите, за да не мине закоментирана настройка */
const live=t=>t.split('\n').map(l=>l.replace(/\s+#.*$/,'')).filter(l=>!/^\s*#/.test(l)&&l.trim());

for(const f of ['render.yaml','render.paid.yaml.example']){
  const L=live(R(f));
  assert.equal(L.filter(l=>/^\s{4}autoDeployTrigger:\s*'?off'?\s*$/.test(l)).length,1,f+': точно един autoDeployTrigger: off на ниво услуга');
  assert(!L.some(l=>/autoDeploy\s*:/.test(l)),f+': без остарялото autoDeploy');
  assert(!L.some(l=>/autoDeployTrigger:\s*'?(commit|checksPass)/.test(l)),f+': без друго правило за качване');
  for(const k of ['BASE_URL','TOTP_KEY','ALERT_EMAIL','SMTP_PASS'])assert(L.some(l=>l.trim()==='- key: '+k),f+': таблото пита за '+k);
}
ok('render.yaml and the paid example turn automatic deploys off and ask for BASE_URL, TOTP_KEY and ALERT_EMAIL');

const ci=live(R('.github/workflows/test.yml')).join('\n');
assert(/- run: npm test\b/.test(ci),'CI пуска npm test');
assert(/- run: npm run test:e2e\b/.test(ci),'CI пуска npm run test:e2e');
assert(/playwright@\d+\.\d+\.\d+/.test(ci),'Playwright е със закована версия');
assert(/PLAYWRIGHT:\s*\$\{\{\s*runner\.temp\s*\}\}\/pw\/node_modules\/playwright/.test(ci),'PLAYWRIGHT сочи мястото, където е сложен');
assert(/CHROME:\s*\/usr\/bin\/google-chrome/.test(ci),'CHROME е зададен');
ok('CI runs both the unit/API tests and the browser tests');

const pkg=JSON.parse(R('package.json'));
assert.deepEqual(pkg.dependencies||{},{},'проектът е без зависимости');assert.deepEqual(pkg.devDependencies||{},{},'и без dev зависимости');
const files=fs.readdirSync(__dirname);
for(const f of files.filter(f=>/\.test\.js$/.test(f)))assert(pkg.scripts.test.includes('test/'+f),f+' липсва в npm test');
for(const f of files.filter(f=>/^e2e.*\.js$/.test(f)))assert(pkg.scripts['test:e2e'].includes('test/'+f),f+' липсва в npm run test:e2e');
ok('every test file is part of npm test or npm run test:e2e, and there are no dependencies');
console.log('config: all '+n+' checks passed');
