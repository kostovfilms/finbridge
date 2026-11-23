'use strict';
/* Възстановяване от копие, направено със scripts/snapshot.js.
   Ползване: DATA_DIR=/data node scripts/restore.js <папка с копието> [--force]
   Спрете сървъра преди това. Проверява манифеста и целостта на базата. Нищо не се изтрива: ако целта има данни, са нужни --force и старите данни се преместват настрана. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const args = process.argv.slice(2), force = args.includes('--force'), from = args.find(a => !a.startsWith('--'));
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const die = m => { console.error(m); process.exit(1); };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if (!from) die('Посочете папка с копие: node scripts/restore.js <папка> [--force]');
const src = path.resolve(from), mf = path.join(src, 'manifest.json');
if (!fs.existsSync(mf)) die('В ' + src + ' няма manifest.json. Това не е копие от snapshot.js.');
const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
if (m.app !== 'finbridge' || m.format !== 1) die('Непознат формат на копието.');
const dbSrc = path.join(src, 'finbridge.db');
if (!fs.existsSync(dbSrc) || sha(dbSrc) !== m.db.sha256) die('Базата в копието е повредена или променена: сумата за проверка не съвпада. Нищо не е възстановено.');
const bad = Object.entries(m.files).filter(([n, h]) => !/^[A-Za-z0-9_-]+$/.test(n) || !fs.existsSync(path.join(src, 'files', n)) || sha(path.join(src, 'files', n)) !== h).map(([n]) => n);
if (bad.length) die('Повредени или липсващи документи в копието (' + bad.length + '): ' + bad.slice(0, 5).join(', ') + '. Нищо не е възстановено.');
const chk = new DatabaseSync(dbSrc, { readOnly: true }), ic = chk.prepare('PRAGMA integrity_check').get(); chk.close();
if (Object.values(ic)[0] !== 'ok') die('Базата в копието не минава проверката за цялост: ' + JSON.stringify(ic));
if (fs.existsSync(path.join(DATA, 'finbridge.db'))) {
  if (!force) die('В ' + DATA + ' вече има данни. Нищо не е променено. Ако наистина искате да ги заместите, добавете --force: старите данни се преместват в ' + DATA + '.before-restore-<време>, не се изтриват.');
  const aside = DATA + '.before-restore-' + new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  fs.renameSync(DATA, aside); console.log('Старите данни са преместени в ' + aside);
}
fs.mkdirSync(path.join(DATA, 'files'), { recursive: true });
fs.copyFileSync(dbSrc, path.join(DATA, 'finbridge.db'));
for (const n of Object.keys(m.files)) fs.copyFileSync(path.join(src, 'files', n), path.join(DATA, 'files', n));
/* Проверка след копирането: същата сума и същите брояци. */
if (sha(path.join(DATA, 'finbridge.db')) !== m.db.sha256) die('Грешка при копирането на базата.');
const db = new DatabaseSync(path.join(DATA, 'finbridge.db')); const got = {};
for (const t of Object.keys(m.counts)) if (m.counts[t] != null) got[t] = db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n; db.close();
for (const t of Object.keys(got)) if (got[t] !== m.counts[t]) die('Брояч ' + t + ': очаквани ' + m.counts[t] + ', получени ' + got[t] + '.');
const orphan = []; { const d2 = new DatabaseSync(path.join(DATA, 'finbridge.db'), { readOnly: true }); for (const r of d2.prepare('SELECT id FROM files').all()) if (!fs.existsSync(path.join(DATA, 'files', r.id))) orphan.push(r.id); d2.close(); }
console.log('Възстановено в ' + DATA + ' от копие от ' + m.createdAt + '.\n  записи: ' + Object.entries(got).map(([k, v]) => k + '=' + v).join(', ') + '\n  документи: ' + Object.keys(m.files).length + (orphan.length ? '\n  ВНИМАНИЕ: ' + orphan.length + ' документа са записани в базата, но ги няма във файловете (изтрити са по време на копирането).' : ''));
