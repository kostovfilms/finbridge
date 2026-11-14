'use strict';
/* FinBridge server. No dependencies: Node.js 22.13+ only (built-in SQLite). */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), net = require('node:net'), tls = require('node:tls');
const { DatabaseSync } = require('node:sqlite');

const env = process.env;
const PORT = +env.PORT || 8080;
const DATA = path.resolve(env.DATA_DIR || path.join(__dirname, 'data'));
const PUB = path.join(__dirname, 'public');
const BASE_URL = (env.BASE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const AI = { key: env.ANTHROPIC_API_KEY || '', url: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''), model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' };
const SMTP = { host: env.SMTP_HOST || '', port: +env.SMTP_PORT || 465, user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.SMTP_FROM || env.SMTP_USER || '', secure: env.SMTP_SECURE !== 'false' };
const ALLOW_SIGNUP = env.ALLOW_SIGNUP !== 'false';
const TRUST_PROXY = env.TRUST_PROXY === 'true';
const MAX_FILE = 15 * 1024 * 1024, MAX_JSON = 1024 * 1024, MAX_AI = 14 * 1024 * 1024;
const SESSION_DAYS = 30;
const REMIND = { days: +env.REMIND_EVERY_DAYS || 3, tick: +env.REMIND_INTERVAL_MS || 1800000, anytime: env.REMIND_ANYTIME === 'true' };
const Fin = new Function(fs.readFileSync(path.join(__dirname, 'public', 'company.html'), 'utf8').split('/*FIN-START*/')[1].split('/*FIN-END*/')[0] + ';return Fin')();
const Core = new Function(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').split('/*CORE-START*/')[1].split('/*CORE-END*/')[0] + ';return Core')();

fs.mkdirSync(path.join(DATA, 'files'), { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'finbridge.db'));
db.exec(`
PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS offices(id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id), email TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS firms(office_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, portal_token TEXT NOT NULL UNIQUE, PRIMARY KEY(office_id, id));
CREATE TABLE IF NOT EXISTS periods(office_id TEXT NOT NULL, firm_id TEXT NOT NULL, period TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(office_id, firm_id, period));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, office_id TEXT NOT NULL, firm_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS files_inbox ON files(office_id, status);
CREATE TABLE IF NOT EXISTS replies(id TEXT PRIMARY KEY, office_id TEXT NOT NULL, firm_id TEXT NOT NULL, period TEXT NOT NULL, tx_id TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS autolog(office_id TEXT NOT NULL, firm_id TEXT NOT NULL, sent_at TEXT NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resets(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
`);
for (const sql of ["ALTER TABLE files ADD COLUMN kind TEXT NOT NULL DEFAULT 'invoice'", "ALTER TABLE files ADD COLUMN tx_hint TEXT NOT NULL DEFAULT ''", "ALTER TABLE files ADD COLUMN period_hint TEXT NOT NULL DEFAULT ''"]){ try { db.exec(sql); } catch (e) { /* колоната вече съществува */ } }
db.exec("CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, office_id TEXT NOT NULL, firm_id TEXT NOT NULL, period TEXT NOT NULL, tx_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, asked TEXT NOT NULL, answered TEXT NOT NULL DEFAULT '')");
for (const sql of ["ALTER TABLE users ADD COLUMN firm_id TEXT NOT NULL DEFAULT ''", "ALTER TABLE users ADD COLUMN crole TEXT NOT NULL DEFAULT ''", "ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''", "ALTER TABLE offices ADD COLUMN solo INTEGER NOT NULL DEFAULT 0"]){ try { db.exec(sql); } catch (e) { /* колоната вече съществува */ } }
db.exec('CREATE TABLE IF NOT EXISTS fin(id TEXT PRIMARY KEY, office_id TEXT NOT NULL, firm_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS fin_firm ON fin(office_id, firm_id)');
db.exec('CREATE TABLE IF NOT EXISTS finset(office_id TEXT NOT NULL, firm_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(office_id, firm_id))');
db.exec('CREATE TABLE IF NOT EXISTS kv(office_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(office_id, key))');
const q = sql => db.prepare(sql);
const now = () => new Date().toISOString();
const rid = n => crypto.randomBytes(n).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, code, message){ super(message || code); this.status = status; this.code = code; } }
const bad = (status, code, message) => { throw new HttpError(status, code, message); };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function send(res, status, body, headers){
  const h = Object.assign({}, SEC, headers);
  if (body != null && typeof body === 'object' && !Buffer.isBuffer(body)){ body = JSON.stringify(body); h['Content-Type'] = 'application/json; charset=utf-8'; h['Cache-Control'] = 'no-store'; }
  res.writeHead(status, h); res.end(body == null ? '' : body);
}
function readBody(req, limit){
  return new Promise((ok, no) => {
    if (+req.headers['content-length'] > limit) return no(new HttpError(413, 'too_large', 'Файлът е твърде голям.'));
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit){ no(new HttpError(413, 'too_large', 'Файлът е твърде голям.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', no);
  });
}
async function readJson(req, limit){
  const b = await readBody(req, limit || MAX_JSON);
  try { const v = JSON.parse(b.toString('utf8') || '{}'); if (!v || typeof v !== 'object') throw 0; return v; } catch (e) { bad(400, 'bad_json', 'Невалидна заявка.'); }
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]).map(c => [c[0], decodeURIComponent(c.slice(1).join('='))]));
const ipOf = req => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
const origin = req => BASE_URL || ((TRUST_PROXY && req.headers['x-forwarded-proto']) || 'http') + '://' + req.headers.host;
const hits = new Map();
function limit(key, max, windowMs){
  const t = Date.now(); let h = hits.get(key);
  if (!h || h.reset < t){ h = { n: 0, reset: t + windowMs }; hits.set(key, h); }
  if (++h.n > max) bad(429, 'rate_limited', 'Твърде много опити. Опитайте по-късно.');
}
setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (h.reset < t) hits.delete(k); q('DELETE FROM sessions WHERE expires < ?').run(t); }, 600000).unref();

function hashPass(p){ const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); }
function checkPass(p, stored){
  const [s, h] = String(stored).split(':'); if (!s || !h) return false;
  const a = crypto.scryptSync(p, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function startSession(req, res, userId){
  const token = rid(32);
  q('INSERT INTO sessions(token_hash, user_id, expires) VALUES(?,?,?)').run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return 'fb_s=' + token + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + SESSION_DAYS * 86400 + (origin(req).startsWith('https') ? '; Secure' : '');
}
function auth(req){
  const t = cookies(req).fb_s; if (!t) return null;
  const r = q('SELECT u.id, u.email, u.office_id, u.firm_id, u.crole, u.name, o.solo, o.name AS office FROM sessions s JOIN users u ON u.id = s.user_id JOIN offices o ON o.id = u.office_id WHERE s.token_hash = ? AND s.expires > ?').get(sha(t), Date.now());
  return r || null;
}
const ID = /^[A-Za-z0-9-]{1,40}$/, PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/, EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
function sniff(b){
  if (b.length > 4 && b.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504E47) return 'image/png';
  if (b.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const KINDS = ['invoice', 'contract', 'statement', 'other'];
const STMT = { csv: 'text/csv', txt: 'text/plain', sta: 'text/plain', mt940: 'text/plain', 940: 'text/plain', xml: 'application/xml', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };
function storeFile(officeId, firmId, name, buf, source, note, extra){
  extra = extra || {};
  if (!buf.length) bad(400, 'empty', 'Празен файл.');
  const kind = KINDS.includes(extra.kind) ? extra.kind : 'invoice';
  let mime = sniff(buf);
  if (kind === 'statement'){
    const ext = (/\.([A-Za-z0-9]+)$/.exec(String(name || '')) || [])[1], want = STMT[String(ext || '').toLowerCase()];
    if (!want) bad(415, 'bad_type', 'За извлечение се приемат CSV, TXT, MT940, XML, XLSX и PDF.');
    if (want === 'application/pdf' ? mime !== want : want.includes('spreadsheet') ? buf.readUInt16BE(0) !== 0x504B : buf.subarray(0, 2048).includes(0)) bad(415, 'bad_type', 'Файлът не отговаря на разширението си.');
    mime = want;
  } else if (!mime) bad(415, 'bad_type', 'Приемат се само снимки (JPG, PNG, WebP, GIF) и PDF.');
  const id = rid(12), clean = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
  fs.writeFileSync(path.join(DATA, 'files', id), buf);
  q('INSERT INTO files(id, office_id, firm_id, name, mime, size, source, note, status, created, kind, tx_hint, period_hint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, officeId, firmId, String(name || 'file').replace(/[\u0000-\u001f\\/]/g, '_').slice(0, 120), mime, buf.length, source, clean(note, 300), extra.status || (source === 'client' ? 'new' : 'done'), now(), kind,
      /^[A-Za-z0-9_-]{1,60}$/.test(extra.tx || '') ? extra.tx : '', PERIOD.test(extra.period || '') ? extra.period : '');
  return id;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const firmOut = (req, r) => { const last = q('SELECT MAX(sent_at) AS t FROM autolog WHERE office_id = ? AND firm_id = ?').get(r.office_id, r.id).t;
  return Object.assign(JSON.parse(r.data), { id: r.id, portal: origin(req) + '/u/' + r.portal_token }, last ? { lastAuto: last.slice(0, 10) } : {}); };
/* Плащания без документ за фирма: от последните месеци, без тези с чакащ отговор от клиента. */
function missingFor(officeId, firmId, beforePeriod){
  const pending = new Set(q("SELECT period || '/' || tx_id AS k FROM replies WHERE office_id = ? AND firm_id = ? AND status = 'new'").all(officeId, firmId).map(r => r.k));
  const out = [];
  for (const r of q('SELECT period, data FROM periods WHERE office_id = ? AND firm_id = ? ORDER BY period DESC LIMIT 3').all(officeId, firmId)){
    if (beforePeriod && r.period >= beforePeriod) continue;
    let p; try { p = JSON.parse(r.data); } catch (e) { continue; }
    if (p.closed) continue;
    for (const t of p.txs || []) if (t.needsDoc && !t.docId && t.amount < 0) out.push({ period: r.period, tx: t, replied: pending.has(r.period + '/' + t.id) });
  }
  return out.sort((a, b) => String(a.tx.date).localeCompare(String(b.tx.date)));
}

/* ---------- e-mail (SMTP) ---------- */
function sendMail({ to, subject, text, replyTo }){
  return new Promise((ok, no) => {
    const sock = SMTP.secure ? tls.connect({ host: SMTP.host, port: SMTP.port, servername: SMTP.host }) : net.connect({ host: SMTP.host, port: SMTP.port });
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');
    const hdr = s => '=?UTF-8?B?' + b64(String(s).replace(/[\r\n]+/g, ' ').slice(0, 200)) + '?=';
    const addr = (SMTP.from.match(/<([^>]+)>/) || [null, SMTP.from])[1];
    const msg = ['From: ' + SMTP.from, 'To: ' + to, 'Subject: ' + hdr(subject), replyTo ? 'Reply-To: ' + replyTo : null, 'Date: ' + new Date().toUTCString(),
      'Message-ID: <' + rid(12) + '@' + (addr.split('@')[1] || 'finbridge') + '>', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
      b64(text).replace(/(.{76})/g, '$1\r\n')].filter(x => x != null).join('\r\n');
    const steps = [['EHLO finbridge', 250]];
    if (SMTP.user) steps.push(['AUTH LOGIN', 334], [b64(SMTP.user), 334], [b64(SMTP.pass), 235]);
    steps.push(['MAIL FROM:<' + addr + '>', 250], ['RCPT TO:<' + to + '>', 250], ['DATA', 354], [msg + '\r\n.', 250], ['QUIT', 221]);
    let buf = '', i = -1, expect = 220, done = false;
    const fail = m => { if (done) return; done = true; sock.destroy(); no(new HttpError(502, 'mail_failed', m)); };
    sock.setTimeout(20000, () => fail('SMTP сървърът не отговори'));
    sock.on('error', e => fail('SMTP грешка: ' + e.message));
    sock.on('data', d => {
      buf += d.toString('utf8');
      let m;
      while ((m = /^(\d{3})([ -])(.*)\r?\n/m.exec(buf))){
        buf = buf.slice(m.index + m[0].length);
        if (m[2] === '-') continue;
        if (+m[1] !== expect) return fail('SMTP отказ: ' + m[1] + ' ' + m[3].slice(0, 120));
        if (++i >= steps.length){ done = true; sock.end(); return ok(); }
        expect = steps[i][1]; sock.write(steps[i][0] + '\r\n');
      }
    });
    sock.on('close', () => { if (!done) fail('SMTP връзката прекъсна'); });
  });
}

/* ---------- Claude ---------- */
function parseJsonLoose(t){
  const tries = [t, (/```(?:json)?\s*([\s\S]*?)```/.exec(t) || [])[1]];
  const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const x of tries){ if (x == null) continue; try { return { value: JSON.parse(x) }; } catch (e) {} }
  return null;
}
async function askClaude(prompt, images){
  const content = images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }));
  content.push({ type: 'text', text: prompt + '\n\nОтговорът ти ще бъде обработен от програма: върни само JSON, без друг текст.' });
  let r;
  try {
    r = await fetch(AI.url + '/v1/messages', { method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { 'x-api-key': AI.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI.model, max_tokens: 8000, messages: [{ role: 'user', content }] }) });
  } catch (e) { bad(502, 'upstream_error', 'Няма връзка с Claude.'); }
  if (r.status === 429 || r.status === 529) bad(429, 'rate_limited', 'Claude е претоварен или лимитът е достигнат.');
  if (!r.ok){ console.error('Claude API', r.status, (await r.text()).slice(0, 300)); bad(502, 'upstream_error', 'Claude върна грешка ' + r.status + '.'); }
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const v = parseJsonLoose(text);
  if (!v || j.stop_reason === 'max_tokens') bad(502, 'invalid_json', 'Отговорът не беше четим.');
  return v.value;
}

/* ---------- pages ---------- */
const page = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const html = (res, body, status) => send(res, status || 200, body, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
const STATIC = { '/shim.js': 'text/javascript', '/vendor/pdf.min.js': 'text/javascript', '/vendor/pdf.worker.min.js': 'text/javascript' };
const money = n => Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function portalPage(firm){
  const d = JSON.parse(firm.data), all = missingFor(firm.office_id, firm.id), open = all.filter(x => !x.replied);
  const periods = q('SELECT period, data FROM periods WHERE office_id = ? AND firm_id = ? ORDER BY period DESC LIMIT 3').all(firm.office_id, firm.id).map(r => { try { return Object.assign(JSON.parse(r.data), { period: r.period }); } catch (e) { return null; } }).filter(p => p && Array.isArray(p.txs));
  const dm = x => esc(String(x).slice(8, 10) + '.' + String(x).slice(5, 7)), card = (title, body) => '<section class="card">' + (title ? '<h2>' + title + '</h2>' : '') + body + '</section>';
  let out = '';
  const latest = periods.find(p => p.txs.length);
  if (latest){
    const need = latest.txs.filter(t => t.needsDoc && t.amount < 0), done = need.filter(t => t.docId).length, cur = Core.cur(latest.period);
    const left = Core.dayDiff(Core.deadline(latest.period), now().slice(0, 10)), mine = open.filter(x => x.period === latest.period), vat = mine.reduce((s, x) => s + Math.abs(+x.tx.amount || 0), 0) * 20 / 120;
    out += card(esc(Core.periodLabel(latest.period)), '<p><b>' + done + ' от ' + need.length + '</b> плащания са с документ.</p><div class="bar"><i style="width:' + (need.length ? Math.round(done / need.length * 100) : 100) + '%"></i></div>' +
      '<p class="dim">Срок за счетоводството: ' + dm(Core.deadline(latest.period)) + (left > 0 ? ', остават ' + left + (left === 1 ? ' ден' : ' дни') : left === 0 ? ', днес' : ', изтекъл') + '.</p>' +
      (vat >= 1 ? '<p class="warn">Без липсващите документи фирмата може да не приспадне до около ' + esc(money(vat)) + ' ' + cur + ' ДДС.</p>' : ''));
  }
  const qs = q("SELECT id, period, tx_id, question FROM questions WHERE office_id = ? AND firm_id = ? AND status = 'open' ORDER BY asked").all(firm.office_id, firm.id);
  if (qs.length) out += card('Въпроси от счетоводителя', '<ul class="plain">' + qs.map(x => { const p = periods.find(p => p.period === x.period), t = p && p.txs.find(t => t.id === x.tx_id);
    return '<li data-q="' + esc(x.id) + '">' + (t ? '<span class="dim">' + dm(t.date) + ' · ' + esc(t.cp) + ' · ' + esc(money(+t.amount || 0)) + '</span><br>' : '') + '<b>' + esc(x.question) + '</b><div class="reply"><input type="text" maxlength="500" placeholder="Вашият отговор" aria-label="Отговор на въпроса"><button type="button" class="answer">Изпрати</button></div></li>'; }).join('') + '</ul>');
  const li = x => '<li data-period="' + esc(x.period) + '" data-tx="' + esc(x.tx.id) + '"><b>' + dm(x.tx.date) + '</b> · ' + esc(x.tx.cp) + ' · ' + esc(money(+x.tx.amount || 0)) +
    (x.replied ? ' <span class="dim">(изпратено обяснение)</span>' : '<div class="acts"><button type="button" class="forpay">Качи документ</button><button type="button" class="nodoc">Няма документ</button></div>') + '</li>';
  out += card('Липсващи документи', all.length ? '<p>' + (open.length ? 'Липсват документи за ' + open.length + (open.length === 1 ? ' плащане' : ' плащания') + ':' : 'За всички плащания сте изпратили обяснение.') + '</p><ul id="missing" class="plain">' + all.slice(0, 100).map(li).join('') + '</ul>'
    : '<p>В момента няма плащания, за които да липсва документ. Можете да качите документи и предварително.</p>');
  out += '{{UPLOAD}}';
  const hist = q("SELECT name, kind, status, created FROM files WHERE office_id = ? AND firm_id = ? AND source = 'client' ORDER BY created DESC LIMIT 15").all(firm.office_id, firm.id);
  if (hist.length) out += card('Изпратени от вас', '<ul class="plain">' + hist.map(f => '<li>' + dm(f.created) + ' · ' + esc(f.name) + ' · <span class="' + (f.status === 'new' ? 'dim">получен, чака обработка' : 'ok">обработен') + '</span></li>').join('') + '</ul>');
  if (d.stats && periods.length){
    const sum = (p, sign) => p.txs.reduce((s, t) => s + (Math.sign(t.amount) === sign ? Math.abs(+t.amount || 0) : 0), 0), top = {};
    if (latest) for (const t of latest.txs) if (t.amount < 0) top[t.cp] = (top[t.cp] || 0) + Math.abs(+t.amount || 0);
    out += card('Обобщение по банкови движения', '<table><tr><th>Месец</th><th class="num">Разходи</th><th class="num">Постъпления</th></tr>' + periods.map(p => '<tr><td>' + esc(Core.periodLabel(p.period)) + '</td><td class="num">' + esc(money(sum(p, -1))) + '</td><td class="num">' + esc(money(sum(p, 1))) + '</td></tr>').join('') + '</table>' +
      (latest ? '<p class="dim" style="margin-top:10px">Най-големи получатели за ' + esc(Core.periodLabel(latest.period)) + ':</p><table>' + Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => '<tr><td>' + esc(k) + '</td><td class="num">' + esc(money(v)) + '</td></tr>').join('') + '</table>' : ''));
  }
  const tpl = page('portal.html'), up = /<!--UPLOAD-->([\s\S]*?)<!--\/UPLOAD-->/.exec(tpl)[1];
  return tpl.replace(/<!--UPLOAD-->[\s\S]*?<!--\/UPLOAD-->/, '').replace('{{FIRM}}', esc(d.name || '')).replace('{{CARDS}}', () => out.replace('{{UPLOAD}}', () => up));
}

/* ---------- автоматични напомняния ---------- */
function sofia(){ const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])); return { period: p.year + '-' + p.month, hour: +p.hour, weekday: p.weekday }; }
let ticking = false;
async function remindTick(){
  if (ticking || !(SMTP.host && SMTP.from)) return 0;
  const t = sofia();
  if (!REMIND.anytime && (t.hour < 9 || t.hour >= 18 || t.weekday === 'Sat' || t.weekday === 'Sun')) return 0;
  ticking = true; let sent = 0;
  try {
    for (const f of q('SELECT * FROM firms').all()){
      let d; try { d = JSON.parse(f.data); } catch (e) { continue; }
      const to = String(d.address || '').trim();
      if (!d.auto || !EMAIL.test(to)) continue;
      const last = q('SELECT MAX(sent_at) AS t FROM autolog WHERE office_id = ? AND firm_id = ?').get(f.office_id, f.id).t;
      if (last && Date.now() - Date.parse(last) < REMIND.days * 864e5 - 60000) continue;
      const open = missingFor(f.office_id, f.id, t.period).filter(x => !x.replied);
      if (!open.length) continue;
      const per = open[open.length - 1].period, list = open.filter(x => x.period === per).map(x => x.tx);
      const text = Core.reminderText({ contact: d.contact, portal: BASE_URL ? BASE_URL + '/u/' + f.portal_token : '' }, list, per);
      const u = q("SELECT email FROM users WHERE office_id = ? AND firm_id = '' ORDER BY created LIMIT 1").get(f.office_id);
      try { await sendMail({ to, subject: 'Липсващи документи за ' + Core.periodLabel(per), text, replyTo: u && u.email });
        q('INSERT INTO autolog(office_id, firm_id, sent_at, count) VALUES(?,?,?,?)').run(f.office_id, f.id, now(), list.length); sent++; }
      catch (e) { console.error(now(), 'автоматично напомняне до', to, 'не беше изпратено:', e.message); }
    }
  } finally { ticking = false; }
  return sent;
}
setInterval(() => remindTick().catch(e => console.error(e)), REMIND.tick).unref();

/* ---------- финанси на фирмата ---------- */
const FIN_START = { expense: 'submitted', bill: 'submitted', invoice: 'open', budget: 'active' }, CROLES = ['owner', 'approver', 'member'];
const sofiaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date());
function finClean(type, d){
  const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const date = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(Date.parse(v)) ? v : '';
  const num = v => { const n = Math.round((+String(v).replace(',', '.') || 0) * 100) / 100; return n > 0 && n < 1e9 ? n : 0; };
  if (type === 'budget'){ const f = { name: s(d.name, 80), cat: s(d.cat, 60), limit: num(d.limit) }; if (!f.name || !f.limit) bad(400, 'bad_data', 'Въведете име и месечен лимит.'); return f; }
  const f = { party: s(d.party, 120), number: s(d.number, 40), date: date(d.date), due: date(d.due), amount: num(d.amount), cat: s(d.cat, 60), budget: /^[A-Za-z0-9_-]{8,40}$/.test(d.budget || '') ? d.budget : '', pay: Fin.PAY[d.pay] ? d.pay : type === 'expense' ? 'own' : 'bank', note: s(d.note, 300) };
  if (!f.party || !f.date || !f.amount) bad(400, 'bad_data', 'Попълнете дата, контрагент и сума.');
  return f;
}
const finOut = r => { const d = JSON.parse(r.data); return Object.assign({ id: r.id, type: r.type, status: r.status, owner: r.owner, by: d.by, created: r.created, updated: r.updated, file: d.file ? { name: d.file.name } : null, log: d.log || [], paidAt: d.paidAt || '' }, d.f); };
function finSettings(O, F){ const r = q('SELECT data FROM finset WHERE office_id = ? AND firm_id = ?').get(O, F); return Object.assign({}, Fin.DEFAULTS, r ? JSON.parse(r.data) : {}); }
async function finApi(req, res, url, user){
  const p = url.pathname, m = req.method, O = user.office_id, F = user.firm_id || url.searchParams.get('firm') || '';
  const firm = ID.test(F) && q('SELECT * FROM firms WHERE office_id = ? AND id = ?').get(O, F);
  if (!firm) bad(404, 'no_firm', 'Фирмата не съществува.');
  /* Счетоводител, поканен от самата фирма, не управлява екипа ѝ. */
  const role = user.firm_id ? user.crole : user.solo ? 'approver' : 'owner', me = { id: user.id, role }, who = user.name || user.email, set = finSettings(O, F);
  const deny = () => bad(403, 'forbidden', 'Нямате право за това действие.');
  const save = (r, d, status) => q('UPDATE fin SET data = ?, status = ?, updated = ? WHERE id = ?').run(JSON.stringify(d), status, now(), r.id);
  const getOut = id => finOut(q('SELECT * FROM fin WHERE id = ?').get(id));
  let a;
  if (p === '/api/fin/state' && m === 'GET'){
    let items = q('SELECT * FROM fin WHERE office_id = ? AND firm_id = ? ORDER BY created DESC').all(O, F).map(finOut);
    if (role === 'member') items = items.filter(i => i.type === 'budget' || (i.type === 'expense' && i.owner === user.id));
    const out = { firm: { id: F, name: JSON.parse(firm.data).name }, me: { id: user.id, email: user.email, name: user.name, role, office: !user.firm_id }, solo: !!user.solo, settings: set, items, cur: Core.cur(sofiaDay().slice(0, 7)), today: sofiaDay() };
    if (role !== 'member'){
      out.bank = q('SELECT period, data FROM periods WHERE office_id = ? AND firm_id = ? ORDER BY period DESC LIMIT 6').all(O, F).map(r => { let d; try { d = JSON.parse(r.data); } catch (e) { d = {}; }
        const sum = sign => (d.txs || []).reduce((s, t) => s + (Math.sign(t.amount) === sign ? Math.abs(+t.amount || 0) : 0), 0); return { period: r.period, label: Core.periodLabel(r.period), out: Math.round(sum(-1) * 100) / 100, in: Math.round(sum(1) * 100) / 100 }; });
      out.missing = missingFor(O, F).filter(x => !x.replied).length; out.portal = origin(req) + '/u/' + firm.portal_token;
    }
    return send(res, 200, out);
  }
  if (p === '/api/fin/items' && m === 'POST'){
    limit('fin:' + user.id, 300, 3600000);
    const b = await readJson(req), type = String(b.type || '');
    if (!FIN_START[type]) bad(400, 'bad_type');
    if ((type === 'budget' && role !== 'owner') || (type !== 'expense' && role === 'member')) deny();
    const f = finClean(type, b.data || {});
    if (q('SELECT COUNT(*) AS n FROM fin WHERE office_id = ? AND firm_id = ?').get(O, F).n >= 50000) bad(400, 'too_many');
    const id = rid(12), t = now();
    q('INSERT INTO fin(id, office_id, firm_id, type, status, owner, data, created, updated) VALUES(?,?,?,?,?,?,?,?,?)').run(id, O, F, type, FIN_START[type], user.id, JSON.stringify({ f, by: who, log: [{ at: t, who, what: 'created' }] }), t, t);
    return send(res, 200, getOut(id));
  }
  if ((a = /^\/api\/fin\/items\/([A-Za-z0-9_-]{8,40})(\/status|\/file)?$/.exec(p))){
    const r = q('SELECT * FROM fin WHERE id = ? AND office_id = ? AND firm_id = ?').get(a[1], O, F);
    if (!r || (role === 'member' && r.owner !== user.id)) bad(404, 'not_found', 'Записът не е намерен.');
    const d = JSON.parse(r.data), mine = r.owner === user.id, locked = r.status === 'paid' || r.status === 'void';
    const canEdit = !locked && (role === 'owner' || (mine && (r.status === 'submitted' || r.status === 'rejected')) || (role === 'approver' && (r.type === 'bill' || r.type === 'invoice')));
    const fileRow = () => d.file && q('SELECT * FROM files WHERE id = ? AND office_id = ?').get(d.file.id, O);
    if (!a[2] && m === 'PUT'){
      if (!canEdit) deny();
      d.f = finClean(r.type, (await readJson(req)).data || {}); d.log.push({ at: now(), who, what: 'edited' });
      save(r, d, r.status === 'rejected' ? 'submitted' : r.status); return send(res, 200, getOut(r.id));
    }
    if (!a[2] && m === 'DELETE'){
      if (!canEdit && !(role === 'owner' && r.type === 'budget')) deny();
      const f = fileRow(); if (f && f.status === 'held'){ fs.rmSync(path.join(DATA, 'files', f.id), { force: true }); q('DELETE FROM files WHERE id = ?').run(f.id); }
      q('DELETE FROM fin WHERE id = ?').run(r.id); return send(res, 200, { ok: true });
    }
    if (a[2] === '/file' && m === 'GET'){
      const f = fileRow(); if (!f) bad(404, 'not_found');
      return send(res, 200, fs.readFileSync(path.join(DATA, 'files', f.id)), { 'Content-Type': f.mime, 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(f.name), 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'private, no-store' });
    }
    if (a[2] === '/file' && m === 'POST'){
      if (r.type === 'budget' || !(canEdit || (mine && !locked))) deny();
      limit('finup:' + user.id, 120, 3600000);
      const buf = await readBody(req, MAX_FILE), old = fileRow();
      /* Разход отива при счетоводителя след одобрение; фактурите от доставчици и към клиенти веднага. */
      const status = r.type === 'expense' && r.status !== 'approved' ? 'held' : 'new';
      const label = { expense: 'Разход', bill: 'Фактура от доставчик', invoice: 'Издадена фактура' }[r.type] + ': ' + d.f.party + ', ' + d.f.amount.toFixed(2);
      const id = storeFile(O, F, url.searchParams.get('name'), buf, 'company', label, { status, period: d.f.date.slice(0, 7) });
      if (old && old.status === 'held'){ fs.rmSync(path.join(DATA, 'files', old.id), { force: true }); q('DELETE FROM files WHERE id = ?').run(old.id); }
      d.file = { id, name: q('SELECT name FROM files WHERE id = ?').get(id).name }; save(r, d, r.status); return send(res, 200, getOut(r.id));
    }
    if (a[2] === '/status' && m === 'POST'){
      const b = await readJson(req), to = String(b.status || ''), note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300), from = r.status, item = finOut(r);
      let ok = false;
      if (r.type === 'invoice'){ if (role === 'member') deny(); ok = (from === 'open' && (to === 'paid' || to === 'void')) || (from !== 'open' && to === 'open'); }
      else if (r.type !== 'budget'){
        if (to === 'approved' || to === 'rejected'){
          const c = Fin.canApprove(item, me, set); if (!c.ok) bad(403, 'forbidden', c.why);
          if (to === 'rejected' && note.length < 2) bad(400, 'need_reason', 'Напишете причина за отказа.');
          ok = from === 'submitted';
        } else if (to === 'paid'){ if (role === 'member') deny(); ok = from === 'approved'; }
        else if (to === 'submitted') ok = from !== 'submitted' && (role === 'owner' || (from === 'rejected' && mine));
      }
      if (!ok) bad(409, 'bad_state', 'Това действие не е възможно в текущото състояние.');
      d.log.push({ at: now(), who, what: to, note }); if (d.log.length > 50) d.log.splice(1, d.log.length - 50);
      d.paidAt = to === 'paid' ? (/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : sofiaDay()) : '';
      if (to === 'approved' && d.file) q("UPDATE files SET status = 'new' WHERE id = ? AND office_id = ? AND status = 'held'").run(d.file.id, O);
      save(r, d, to);
      const u = !mine && (to === 'approved' || to === 'rejected') && SMTP.host && SMTP.from && q('SELECT email FROM users WHERE id = ?').get(r.owner);
      if (u) sendMail({ to: u.email, subject: (to === 'approved' ? 'Одобрен' : 'Отказан') + ' разход: ' + d.f.party, text: 'Здравейте!\nЗаявката ви за ' + d.f.amount.toFixed(2) + ' към ' + d.f.party + ' от ' + d.f.date + ' е ' + (to === 'approved' ? 'одобрена.' : 'отказана. Причина: ' + note) + '\n' + origin(req) })
        .catch(e => console.error(now(), 'имейл за решение не беше изпратен:', e.message));
      return send(res, 200, getOut(r.id));
    }
  }
  if (p === '/api/fin/settings' && m === 'PUT'){
    if (role !== 'owner') deny();
    const b = (await readJson(req)).data || {}, n = v => Math.max(0, Math.min(1e9, Math.round((+String(v).replace(',', '.') || 0) * 100) / 100));
    const cats = (Array.isArray(b.cats) ? b.cats : []).map(c => String(c).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 40);
    const bal = Math.round((+String(b.balance).replace(',', '.') || 0) * 100) / 100;
    const data = { balance: Math.abs(bal) < 1e10 ? bal : 0, balanceDate: /^\d{4}-\d{2}-\d{2}$/.test(b.balanceDate || '') ? b.balanceDate : sofiaDay(), approverLimit: n(b.approverLimit), receiptOver: n(b.receiptOver), cats: cats.length ? [...new Set(cats)] : Fin.DEFAULTS.cats };
    q('INSERT INTO finset(office_id, firm_id, data) VALUES(?,?,?) ON CONFLICT(office_id, firm_id) DO UPDATE SET data = excluded.data').run(O, F, JSON.stringify(data));
    return send(res, 200, data);
  }
  if (p === '/api/fin/users'){
    if (role !== 'owner') deny();
    if (m === 'GET') return send(res, 200, q("SELECT id, email, name, crole, firm_id, created FROM users WHERE office_id = ? AND (firm_id = ? OR (firm_id = '' AND ?)) ORDER BY created").all(O, F, user.solo ? 1 : 0)
      .map(u => ({ id: u.id, email: u.email, name: u.name, role: u.firm_id ? u.crole : 'accountant', created: u.created.slice(0, 10), me: u.id === user.id })));
    if (m === 'POST'){
      limit('adduser:' + O, 30, 3600000);
      const b = await readJson(req), email = String(b.email || '').trim().toLowerCase(), pass = String(b.password || ''), r = String(b.role || ''), name = String(b.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
      if (!CROLES.includes(r) && !(r === 'accountant' && user.solo)) bad(400, 'bad_role', 'Невалидна роля.');
      if (!EMAIL.test(email) || email.length > 200) bad(400, 'bad_email', 'Невалиден имейл.');
      if (pass.length < 10 || pass.length > 200) bad(400, 'weak_password', 'Паролата трябва да е поне 10 знака.');
      if (q('SELECT 1 FROM users WHERE email = ?').get(email)) bad(409, 'exists', 'Вече има акаунт с този имейл.');
      if (q('SELECT COUNT(*) AS n FROM users WHERE office_id = ? AND firm_id = ?').get(O, F).n >= 300) bad(400, 'too_many', 'Достигнат е лимитът от 300 души.');
      q('INSERT INTO users(id, office_id, email, pass, created, firm_id, crole, name) VALUES(?,?,?,?,?,?,?,?)').run(rid(9), O, email, hashPass(pass), now(), r === 'accountant' ? '' : F, r === 'accountant' ? '' : r, name);
      return send(res, 200, { ok: true });
    }
  }
  if ((a = /^\/api\/fin\/users\/([A-Za-z0-9_-]{6,40})$/.exec(p)) && m === 'DELETE'){
    if (role !== 'owner') deny();
    if (a[1] === user.id) bad(400, 'self', 'Не можете да премахнете собствения си достъп.');
    if (!q("SELECT 1 FROM users WHERE id = ? AND office_id = ? AND (firm_id = ? OR (firm_id = '' AND ?))").get(a[1], O, F, user.solo ? 1 : 0)) bad(404, 'not_found');
    q('DELETE FROM sessions WHERE user_id = ?').run(a[1]); q('DELETE FROM resets WHERE user_id = ?').run(a[1]); q('DELETE FROM users WHERE id = ?').run(a[1]);
    return send(res, 200, { ok: true });
  }
  bad(404, 'not_found');
}

/* ---------- router ---------- */
async function handle(req, res){
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method;
  let a;
  if (p === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (m === 'GET' && STATIC[p]) return send(res, 200, fs.readFileSync(path.join(PUB, p)), { 'Content-Type': STATIC[p] + '; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });

  /* client portal: no login, the secret link is the key */
  if ((a = /^\/u\/([A-Za-z0-9_-]{20,64})(\/upload|\/reply|\/answer)?$/.exec(p))){
    const firm = q('SELECT * FROM firms WHERE portal_token = ?').get(a[1]);
    if (!firm) return html(res, '<!DOCTYPE html><meta charset="utf-8"><title>FinBridge</title><p style="font-family:sans-serif;padding:24px">Тази връзка не е валидна. Поискайте нова от счетоводителя си.</p>', 404);
    if (!a[2] && m === 'GET') return html(res, portalPage(firm));
    if (a[2] === '/reply' && m === 'POST'){
      limit('rp:' + a[1], 60, 3600000);
      const b = await readJson(req), note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
      if (note.length < 2) bad(400, 'bad_note', 'Напишете с няколко думи какво е плащането.');
      const hit = missingFor(firm.office_id, firm.id).find(x => x.period === b.period && x.tx.id === b.tx);
      if (!hit) bad(404, 'no_tx', 'Това плащане вече не е в списъка.');
      if (hit.replied) bad(409, 'exists', 'Вече сте изпратили обяснение за това плащане.');
      q('INSERT INTO replies(id, office_id, firm_id, period, tx_id, note, status, created) VALUES(?,?,?,?,?,?,?,?)').run(rid(12), firm.office_id, firm.id, hit.period, hit.tx.id, note, 'new', now());
      return send(res, 200, { ok: true });
    }
    if (a[2] === '/answer' && m === 'POST'){
      limit('rp:' + a[1], 60, 3600000);
      const b = await readJson(req), text = String(b.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
      if (text.length < 1) bad(400, 'bad_note', 'Напишете отговор.');
      const r = q("UPDATE questions SET answer = ?, status = 'answered', answered = ? WHERE id = ? AND office_id = ? AND firm_id = ? AND status = 'open'").run(text, now(), String(b.id || ''), firm.office_id, firm.id);
      if (!r.changes) bad(404, 'no_question', 'Този въпрос вече е затворен.');
      return send(res, 200, { ok: true });
    }
    if (a[2] === '/upload' && m === 'POST'){
      limit('up:' + a[1], 60, 3600000);
      const buf = await readBody(req, MAX_FILE);
      storeFile(firm.office_id, firm.id, url.searchParams.get('name'), buf, 'client', url.searchParams.get('note'), { kind: url.searchParams.get('kind'), tx: url.searchParams.get('tx'), period: url.searchParams.get('period') });
      return send(res, 200, { ok: true });
    }
    bad(405, 'method');
  }

  const user = auth(req);
  if (m === 'GET' && (p === '/' || p === '/index.html')){
    if (!user) return send(res, 302, '', { Location: '/login' });
    if (user.firm_id) return html(res, page('company.html'));
    return html(res, page('index.html').replace('<script>\n/*CORE-START*/', '<script src="/shim.js"></script>\n<script>\n/*CORE-START*/'));
  }
  if (m === 'GET' && p === '/company') return user ? html(res, page('company.html')) : send(res, 302, '', { Location: '/login' });
  if (m === 'GET' && p === '/reset') return html(res, page('login.html').replace('{{SIGNUP}}', 'hidden'));
  if (m === 'GET' && p === '/login') return user ? send(res, 302, '', { Location: '/' }) : html(res, page('login.html').replace('{{SIGNUP}}', ALLOW_SIGNUP ? '' : 'hidden'));
  if (!p.startsWith('/api/')) bad(404, 'not_found');
  if (m !== 'GET' && req.headers['x-fb'] !== '1') bad(403, 'csrf', 'Липсва защитният хедър.');

  if (p === '/api/register' && m === 'POST'){
    if (!ALLOW_SIGNUP) bad(403, 'signup_closed', 'Регистрацията е затворена.');
    limit('reg:' + ipOf(req), 5, 3600000);
    const b = await readJson(req), email = String(b.email || '').trim().toLowerCase(), office = String(b.office || '').trim().slice(0, 120), pass = String(b.password || '');
    if (!EMAIL.test(email) || email.length > 200) bad(400, 'bad_email', 'Невалиден имейл.');
    const solo = b.kind === 'company';
    if (!office) bad(400, 'bad_office', solo ? 'Въведете име на фирмата.' : 'Въведете име на кантората.');
    if (pass.length < 10 || pass.length > 200) bad(400, 'weak_password', 'Паролата трябва да е поне 10 знака.');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) bad(409, 'exists', 'Вече има акаунт с този имейл.');
    const oid = rid(9), uid = rid(9);
    q('INSERT INTO offices(id, name, created, solo) VALUES(?,?,?,?)').run(oid, office, now(), solo ? 1 : 0);
    const fid = solo ? 'f' + crypto.randomBytes(6).toString('hex') : '';
    if (solo) q('INSERT INTO firms(office_id, id, data, portal_token) VALUES(?,?,?,?)').run(oid, fid, JSON.stringify({ name: office, eik: '', contact: '', channel: 'email', address: email, auto: false, stats: true }), rid(24));
    q('INSERT INTO users(id, office_id, email, pass, created, firm_id, crole) VALUES(?,?,?,?,?,?,?)').run(uid, oid, email, hashPass(pass), now(), fid, solo ? 'owner' : '');
    return send(res, 200, { ok: true }, { 'Set-Cookie': startSession(req, res, uid) });
  }
  if (p === '/api/login' && m === 'POST'){
    const b = await readJson(req), email = String(b.email || '').trim().toLowerCase();
    limit('login:' + ipOf(req) + ':' + email, 10, 900000);
    const u = q('SELECT id, pass FROM users WHERE email = ?').get(email);
    if (!u || !checkPass(String(b.password || ''), u.pass)) bad(401, 'bad_login', 'Грешен имейл или парола.');
    return send(res, 200, { ok: true }, { 'Set-Cookie': startSession(req, res, u.id) });
  }
  if (p === '/api/forgot' && m === 'POST'){
    limit('forgot:' + ipOf(req), 5, 3600000);
    const b = await readJson(req), u = q('SELECT id, email FROM users WHERE email = ?').get(String(b.email || '').trim().toLowerCase());
    if (u && SMTP.host && SMTP.from){
      const token = rid(32);
      q('DELETE FROM resets WHERE user_id = ? OR expires < ?').run(u.id, Date.now());
      q('INSERT INTO resets(token_hash, user_id, expires) VALUES(?,?,?)').run(sha(token), u.id, Date.now() + 3600000);
      sendMail({ to: u.email, subject: 'Нова парола за FinBridge', text: 'Здравейте!\nЗа да зададете нова парола, отворете тази връзка до един час:\n' + origin(req) + '/reset#' + token + '\nАко не сте искали смяна, не правете нищо.' })
        .catch(e => console.error(now(), 'имейл за нова парола не беше изпратен:', e.message));
    }
    return send(res, 200, { ok: true, mail: !!(SMTP.host && SMTP.from) });
  }
  if (p === '/api/reset' && m === 'POST'){
    limit('reset:' + ipOf(req), 10, 3600000);
    const b = await readJson(req), pass = String(b.password || ''), r = q('SELECT user_id FROM resets WHERE token_hash = ? AND expires > ?').get(sha(String(b.token || '')), Date.now());
    if (!r) bad(400, 'bad_token', 'Връзката е невалидна или изтекла. Поискайте нова.');
    if (pass.length < 10 || pass.length > 200) bad(400, 'weak_password', 'Паролата трябва да е поне 10 знака.');
    q('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(pass), r.user_id);
    q('DELETE FROM sessions WHERE user_id = ?').run(r.user_id); q('DELETE FROM resets WHERE user_id = ?').run(r.user_id);
    return send(res, 200, { ok: true });
  }
  if (!user) bad(401, 'unauthorized', 'Влезте в акаунта си.');
  const O = user.office_id;
  if (p === '/api/logout' && m === 'POST'){
    q('DELETE FROM sessions WHERE token_hash = ?').run(sha(cookies(req).fb_s));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'fb_s=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' });
  }
  if (user.firm_id && !p.startsWith('/api/fin/') && p !== '/api/me' && p !== '/api/password') bad(403, 'forbidden', 'Нямате достъп до тази част.');
  if (p === '/api/me' && user.firm_id) return send(res, 200, { company: true, email: user.email, role: user.crole });
  if (p.startsWith('/api/fin/')) return finApi(req, res, url, user);
  if (p === '/api/me') return send(res, 200, { solo: !!user.solo, office: user.office, email: user.email, ai: !!AI.key, mail: !!(SMTP.host && SMTP.from), remindDays: REMIND.days });
  if (p === '/api/users' && m === 'GET') return send(res, 200, q("SELECT id, email, created FROM users WHERE office_id = ? AND firm_id = '' ORDER BY created").all(O).map(u => ({ id: u.id, email: u.email, created: u.created.slice(0, 10), me: u.id === user.id })));
  if (p === '/api/users' && m === 'POST'){
    limit('adduser:' + O, 20, 3600000);
    const b = await readJson(req), email = String(b.email || '').trim().toLowerCase(), pass = String(b.password || '');
    if (!EMAIL.test(email) || email.length > 200) bad(400, 'bad_email', 'Невалиден имейл.');
    if (pass.length < 10 || pass.length > 200) bad(400, 'weak_password', 'Паролата трябва да е поне 10 знака.');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) bad(409, 'exists', 'Вече има акаунт с този имейл.');
    if (q("SELECT COUNT(*) AS n FROM users WHERE office_id = ? AND firm_id = ''").get(O).n >= 50) bad(400, 'too_many', 'Достигнат е лимитът от 50 души в екипа.');
    q('INSERT INTO users(id, office_id, email, pass, created) VALUES(?,?,?,?,?)').run(rid(9), O, email, hashPass(pass), now());
    return send(res, 200, { ok: true });
  }
  if ((a = /^\/api\/users\/([A-Za-z0-9_-]{6,40})$/.exec(p)) && m === 'DELETE'){
    if (a[1] === user.id) bad(400, 'self', 'Не можете да премахнете собствения си достъп.');
    if (!q("SELECT 1 FROM users WHERE id = ? AND office_id = ? AND firm_id = ''").get(a[1], O)) bad(404, 'not_found');
    q('DELETE FROM sessions WHERE user_id = ?').run(a[1]); q('DELETE FROM resets WHERE user_id = ?').run(a[1]); q('DELETE FROM users WHERE id = ?').run(a[1]);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && m === 'POST'){
    limit('pass:' + user.id, 10, 900000);
    const b = await readJson(req), next = String(b.next || '');
    if (!checkPass(String(b.old || ''), q('SELECT pass FROM users WHERE id = ?').get(user.id).pass)) bad(400, 'bad_password', 'Текущата парола не е вярна.');
    if (next.length < 10 || next.length > 200) bad(400, 'weak_password', 'Новата парола трябва да е поне 10 знака.');
    q('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(next), user.id);
    q('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha(cookies(req).fb_s));
    return send(res, 200, { ok: true });
  }
  if (p === '/api/backup' && m === 'GET'){
    const out = { exportedAt: now(), office: user.office, firms: q('SELECT id, data FROM firms WHERE office_id = ?').all(O).map(r => Object.assign({ id: r.id }, JSON.parse(r.data))),
      periods: q('SELECT firm_id, period, data FROM periods WHERE office_id = ? ORDER BY firm_id, period').all(O).map(r => JSON.parse(r.data)),
      rules: (r => r ? JSON.parse(r.data) : {})(q("SELECT data FROM kv WHERE office_id = ? AND key = 'rules'").get(O)),
      finance: q('SELECT firm_id AS firm, type, status, data, created FROM fin WHERE office_id = ? ORDER BY created').all(O).map(r => Object.assign({ firm: r.firm, type: r.type, status: r.status, created: r.created }, JSON.parse(r.data).f)),
      questions: q('SELECT firm_id AS firm, period, tx_id AS tx, question, answer, status, asked, answered FROM questions WHERE office_id = ? ORDER BY asked').all(O) };
    return send(res, 200, Buffer.from(JSON.stringify(out, null, 1)), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="finbridge-arhiv-' + now().slice(0, 10) + '.json"', 'Cache-Control': 'no-store' });
  }
  if (p === '/api/replies' && m === 'GET') return send(res, 200, q("SELECT id, firm_id AS firm, period, tx_id AS tx, note, created FROM replies WHERE office_id = ? AND status = 'new' ORDER BY created").all(O));
  if ((a = /^\/api\/replies\/([A-Za-z0-9_-]{8,40})\/done$/.exec(p)) && m === 'POST'){
    q("UPDATE replies SET status = 'done' WHERE id = ? AND office_id = ?").run(a[1], O); return send(res, 200, { ok: true });
  }
  if (p === '/api/questions' && m === 'GET') return send(res, 200, q("SELECT id, firm_id AS firm, period, tx_id AS tx, question, answer, asked FROM questions WHERE office_id = ? AND status != 'closed' ORDER BY asked").all(O));
  if (p === '/api/questions' && m === 'POST'){
    const b = await readJson(req), text = String(b.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300), firm = String(b.firm || ''), per = String(b.period || ''), tx = String(b.tx || '');
    const f = q('SELECT * FROM firms WHERE office_id = ? AND id = ?').get(O, firm);
    if (!f) bad(404, 'no_firm'); if (!PERIOD.test(per) || !/^[A-Za-z0-9_-]{1,60}$/.test(tx)) bad(400, 'bad_id'); if (text.length < 2) bad(400, 'bad_text', 'Напишете въпроса.');
    if (q("SELECT COUNT(*) AS n FROM questions WHERE office_id = ? AND firm_id = ? AND status = 'open'").get(O, firm).n >= 50) bad(400, 'too_many', 'Има твърде много отворени въпроси към тази фирма.');
    const id = rid(12); q('INSERT INTO questions(id, office_id, firm_id, period, tx_id, question, status, asked) VALUES(?,?,?,?,?,?,?,?)').run(id, O, firm, per, tx, text, 'open', now());
    const d = JSON.parse(f.data), to = String(d.address || '').trim();
    if (SMTP.host && SMTP.from && EMAIL.test(to)) sendMail({ to, replyTo: user.email, subject: 'Въпрос от счетоводителя', text: 'Здравейте' + (d.contact ? ', ' + d.contact : '') + '!\nСчетоводителят ви има въпрос:\n' + text + '\nОтговорете тук: ' + origin(req) + '/u/' + f.portal_token })
      .catch(e => console.error(now(), 'имейл с въпрос не беше изпратен:', e.message));
    return send(res, 200, { id });
  }
  if ((a = /^\/api\/questions\/([A-Za-z0-9_-]{8,40})\/close$/.exec(p)) && m === 'POST'){
    q("UPDATE questions SET status = 'closed' WHERE id = ? AND office_id = ?").run(a[1], O); return send(res, 200, { ok: true });
  }
  if (p === '/api/remind-now' && m === 'POST' && REMIND.anytime) return send(res, 200, { sent: await remindTick() });

  if (p === '/api/firms' && m === 'GET') return send(res, 200, q('SELECT * FROM firms WHERE office_id = ?').all(O).map(r => firmOut(req, r)));
  if ((a = /^\/api\/firms\/([^/]+)(\/portal-reset)?$/.exec(p))){
    const id = a[1]; if (!ID.test(id)) bad(400, 'bad_id');
    const cur = q('SELECT * FROM firms WHERE office_id = ? AND id = ?').get(O, id);
    if (a[2] && m === 'POST'){ if (!cur) bad(404, 'not_found'); const t = rid(24); q('UPDATE firms SET portal_token = ? WHERE office_id = ? AND id = ?').run(t, O, id); return send(res, 200, { portal: origin(req) + '/u/' + t }); }
    if (m === 'PUT'){
      const b = await readJson(req), d = b.data && typeof b.data === 'object' ? b.data : bad(400, 'bad_data');
      const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
      const data = JSON.stringify({ name: s(d.name, 160), eik: s(d.eik, 20), contact: s(d.contact, 120), channel: s(d.channel, 20), address: s(d.address, 200), auto: d.auto === true, stats: d.stats === true });
      if (!JSON.parse(data).name) bad(400, 'bad_name', 'Липсва име на фирмата.');
      if (cur) q('UPDATE firms SET data = ? WHERE office_id = ? AND id = ?').run(data, O, id);
      else { if (q('SELECT COUNT(*) AS n FROM firms WHERE office_id = ?').get(O).n >= 2000) bad(400, 'too_many'); q('INSERT INTO firms(office_id, id, data, portal_token) VALUES(?,?,?,?)').run(O, id, data, rid(24)); }
      return send(res, 200, firmOut(req, q('SELECT * FROM firms WHERE office_id = ? AND id = ?').get(O, id)));
    }
    if (m === 'DELETE'){
      for (const f of q('SELECT id FROM files WHERE office_id = ? AND firm_id = ?').all(O, id)) fs.rmSync(path.join(DATA, 'files', f.id), { force: true });
      q('DELETE FROM files WHERE office_id = ? AND firm_id = ?').run(O, id);
      q('DELETE FROM periods WHERE office_id = ? AND firm_id = ?').run(O, id);
      q('DELETE FROM replies WHERE office_id = ? AND firm_id = ?').run(O, id); q('DELETE FROM questions WHERE office_id = ? AND firm_id = ?').run(O, id); q('DELETE FROM autolog WHERE office_id = ? AND firm_id = ?').run(O, id);
      q('DELETE FROM fin WHERE office_id = ? AND firm_id = ?').run(O, id); q('DELETE FROM finset WHERE office_id = ? AND firm_id = ?').run(O, id);
      for (const u of q('SELECT id FROM users WHERE office_id = ? AND firm_id = ?').all(O, id)){ q('DELETE FROM sessions WHERE user_id = ?').run(u.id); q('DELETE FROM resets WHERE user_id = ?').run(u.id); q('DELETE FROM users WHERE id = ?').run(u.id); }
      q('DELETE FROM firms WHERE office_id = ? AND id = ?').run(O, id);
      return send(res, 200, { ok: true });
    }
  }
  if (p === '/api/periods' && m === 'GET'){
    const per = url.searchParams.get('period'); if (!PERIOD.test(per || '')) bad(400, 'bad_period');
    return send(res, 200, q('SELECT firm_id, data, version FROM periods WHERE office_id = ? AND period = ?').all(O, per).map(r => ({ firm: r.firm_id, version: r.version, data: JSON.parse(r.data) })));
  }
  if ((a = /^\/api\/period\/([^/]+)\/([^/]+)$/.exec(p))){
    const [, firm, per] = a; if (!ID.test(firm) || !PERIOD.test(per)) bad(400, 'bad_id');
    const cur = q('SELECT data, version FROM periods WHERE office_id = ? AND firm_id = ? AND period = ?').get(O, firm, per);
    if (m === 'GET') return send(res, 200, cur ? { exists: true, version: cur.version, data: JSON.parse(cur.data) } : { exists: false });
    if (m === 'PUT'){
      if (!q('SELECT 1 FROM firms WHERE office_id = ? AND id = ?').get(O, firm)) bad(404, 'no_firm', 'Фирмата не съществува.');
      const b = await readJson(req, 2 * MAX_JSON), d = b.data;
      if (!d || typeof d !== 'object' || !Array.isArray(d.txs) || !Array.isArray(d.docs)) bad(400, 'bad_data');
      d.firm = firm; d.period = per; if (!Array.isArray(d.reminders)) d.reminders = [];
      const v = (cur ? cur.version : 0) + 1;
      q('INSERT INTO periods(office_id, firm_id, period, data, version, updated) VALUES(?,?,?,?,?,?) ON CONFLICT(office_id, firm_id, period) DO UPDATE SET data = excluded.data, version = excluded.version, updated = excluded.updated')
        .run(O, firm, per, JSON.stringify(d), v, now());
      return send(res, 200, { version: v });
    }
    if (m === 'DELETE'){ q('DELETE FROM periods WHERE office_id = ? AND firm_id = ? AND period = ?').run(O, firm, per); return send(res, 200, { ok: true }); }
  }
  if ((a = /^\/api\/kv\/([a-z]{1,20})$/.exec(p))){
    if (m === 'GET'){ const r = q('SELECT data FROM kv WHERE office_id = ? AND key = ?').get(O, a[1]); return send(res, 200, r ? { exists: true, data: JSON.parse(r.data) } : { exists: false }); }
    if (m === 'PUT'){ const b = await readJson(req); if (!b.data || typeof b.data !== 'object') bad(400, 'bad_data');
      q('INSERT INTO kv(office_id, key, data) VALUES(?,?,?) ON CONFLICT(office_id, key) DO UPDATE SET data = excluded.data').run(O, a[1], JSON.stringify(b.data)); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/inbox' && m === 'GET') return send(res, 200, q("SELECT id, firm_id AS firm, name, mime, size, note, created, kind, tx_hint AS tx, period_hint AS period FROM files WHERE office_id = ? AND status = 'new' ORDER BY created").all(O));
  if (p === '/api/files' && m === 'POST'){
    const firm = url.searchParams.get('firm') || '';
    if (!q('SELECT 1 FROM firms WHERE office_id = ? AND id = ?').get(O, firm)) bad(404, 'no_firm');
    return send(res, 200, { id: storeFile(O, firm, url.searchParams.get('name'), await readBody(req, MAX_FILE), 'office', '') });
  }
  if ((a = /^\/api\/files\/([A-Za-z0-9_-]{8,40})(\/done)?$/.exec(p))){
    const f = q('SELECT * FROM files WHERE id = ? AND office_id = ?').get(a[1], O); if (!f) bad(404, 'not_found');
    if (a[2] && m === 'POST'){ q("UPDATE files SET status = 'done' WHERE id = ?").run(f.id); return send(res, 200, { ok: true }); }
    if (m === 'GET') return send(res, 200, fs.readFileSync(path.join(DATA, 'files', f.id)), { 'Content-Type': f.mime, 'Content-Disposition': (/^image\/|^application\/pdf$/.test(f.mime) ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(f.name), 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'private, no-store' });
    if (m === 'DELETE'){ fs.rmSync(path.join(DATA, 'files', f.id), { force: true }); q('DELETE FROM files WHERE id = ?').run(f.id); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/ai' && m === 'POST'){
    if (!AI.key) bad(503, 'sampling_disabled', 'Не е зададен ANTHROPIC_API_KEY.');
    limit('ai:' + O, 300, 3600000);
    const b = await readJson(req, MAX_AI), prompt = String(b.prompt || '');
    if (!prompt || prompt.length > 300000) bad(400, 'prompt_too_large');
    const images = (Array.isArray(b.images) ? b.images : []).slice(0, 5).map(i => ({ mime: String(i && i.mime), data: String(i && i.data) }));
    if (images.some(i => !/^image\/(jpeg|png|webp|gif)$/.test(i.mime) || !/^[A-Za-z0-9+/=]+$/.test(i.data))) bad(400, 'image_rejected');
    return send(res, 200, { value: await askClaude(prompt, images) });
  }
  if (p === '/api/email' && m === 'POST'){
    if (!(SMTP.host && SMTP.from)) bad(503, 'mail_disabled', 'Изпращането на имейли не е настроено.');
    limit('mail:' + O, 60, 3600000);
    const b = await readJson(req), f = q('SELECT data FROM firms WHERE office_id = ? AND id = ?').get(O, String(b.firm || ''));
    if (!f) bad(404, 'no_firm');
    const to = String(JSON.parse(f.data).address || '').trim(), text = String(b.text || '').slice(0, 20000);
    if (!EMAIL.test(to)) bad(400, 'bad_email', 'Фирмата няма валиден имейл адрес.');
    if (!text.trim()) bad(400, 'empty', 'Празно съобщение.');
    await sendMail({ to, subject: String(b.subject || 'Липсващи документи'), text, replyTo: user.email });
    return send(res, 200, { ok: true });
  }
  bad(404, 'not_found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (!(e instanceof HttpError)) console.error(now(), req.method, req.url, e);
    if (res.headersSent) return res.end();
    send(res, e.status || 500, { error: e.code || 'server_error', message: e instanceof HttpError ? e.message : 'Вътрешна грешка.' });
  });
});
server.listen(PORT, () => console.log('FinBridge слуша на порт ' + PORT + ' · данни: ' + DATA + ' · Claude: ' + (AI.key ? AI.model : 'изключен') + ' · имейл: ' + (SMTP.host || 'изключен')));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
