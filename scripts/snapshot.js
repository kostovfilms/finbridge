'use strict';
/* Пълно, съгласувано копие на данните (база + документи) без спиране на сървъра.
   Ползване: DATA_DIR=/data node scripts/snapshot.js [папка за копието]
   Базата се копира с VACUUM INTO (SQLite го прави съгласувано дори докато сървърът пише), документите се копират и се записва манифест със суми за проверка. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = path.resolve(process.argv[2] || path.join(process.cwd(), 'snapshots', 'finbridge-' + stamp));
const die = m => { console.error(m); process.exit(1); };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const dbFile = path.join(DATA, 'finbridge.db');
if (!fs.existsSync(dbFile)) die('Няма база в ' + DATA + '. Задайте DATA_DIR.');
if (fs.existsSync(out) && fs.readdirSync(out).length) die('Папката ' + out + ' не е празна. Копията не се презаписват.');
fs.mkdirSync(path.join(out, 'files'), { recursive: true });
const db = new DatabaseSync(dbFile); db.exec('PRAGMA busy_timeout = 15000');
const target = path.join(out, 'finbridge.db');
db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
const counts = {};
for (const t of ['offices', 'users', 'firms', 'periods', 'files', 'fin']) { try { counts[t] = db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n; } catch (e) { counts[t] = null; } }
db.close();
const files = {}; let bytes = 0;
const src = path.join(DATA, 'files');
if (fs.existsSync(src)) for (const n of fs.readdirSync(src).sort()) { const s = path.join(src, n); if (!fs.statSync(s).isFile()) continue; fs.copyFileSync(s, path.join(out, 'files', n)); files[n] = sha(s); bytes += fs.statSync(s).size; }
const manifest = { app: 'finbridge', format: 1, createdAt: new Date().toISOString(), source: DATA, db: { sha256: sha(target), bytes: fs.statSync(target).size }, counts, files, fileBytes: bytes };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('Копието е готово: ' + out + '\n  база: ' + manifest.db.bytes + ' байта, документи: ' + Object.keys(files).length + ' (' + bytes + ' байта)\n  записи: ' + Object.entries(counts).map(([k, v]) => k + '=' + v).join(', '));
