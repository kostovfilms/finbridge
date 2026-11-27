'use strict';
/* Администриране от командния ред: node admin.js <команда>. Ползва същата DATA_DIR като сървъра. */
const path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')), 'finbridge.db'));
const hash = p => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(p, s, 64).toString('hex'); };
const [cmd, a, b, c] = process.argv.slice(2);
const user = e => db.prepare('SELECT * FROM users WHERE email = ?').get(String(e || '').toLowerCase());
const die = m => { console.error(m); process.exit(1); };
const okPass = p => (p && p.length >= 10) || die('Паролата трябва да е поне 10 знака.');
if (cmd === 'list'){
  for (const o of db.prepare('SELECT * FROM offices ORDER BY created').all()){
    const n = db.prepare('SELECT COUNT(*) AS n FROM firms WHERE office_id = ?').get(o.id).n;
    console.log(o.name + ' (' + n + ' фирми): ' + db.prepare('SELECT email FROM users WHERE office_id = ?').all(o.id).map(u => u.email).join(', '));
  }
} else if (cmd === 'set-password'){
  const u = user(a) || die('Няма потребител с този имейл.'); okPass(b);
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hash(b), u.id); db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  console.log('Паролата е сменена и всички сесии на ' + u.email + ' са прекратени.');
} else if (cmd === 'add-user'){
  const u = user(a) || die('Няма потребител с имейл ' + a + '.'); okPass(c);
  const email = String(b || '').toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('Невалиден имейл.'); if (user(email)) die('Този имейл вече е зает.');
  db.prepare('INSERT INTO users(id, office_id, email, pass, created) VALUES(?,?,?,?,?)').run(crypto.randomBytes(9).toString('base64url'), u.office_id, email, hash(c), new Date().toISOString());
  console.log(email + ' е добавен към кантората на ' + u.email + '.');
} else if (cmd === 'disable-2fa'){
  const u = user(a) || die('Няма потребител с този имейл.');
  db.prepare("UPDATE users SET totp_secret = '', totp_pending = '', totp_last = 0 WHERE id = ?").run(u.id); db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  console.log('Двуфакторният вход на ' + u.email + ' е изключен и всички сесии са прекратени.');
} else {
  console.log('Команди:\n  node admin.js list\n  node admin.js set-password <имейл> <нова парола>\n  node admin.js add-user <имейл на колега от кантората> <нов имейл> <парола>\n  node admin.js disable-2fa <имейл>');
}
