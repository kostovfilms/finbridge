/* Свързва страницата със сървъра на FinBridge: съхранение, Claude, изтегляне, клиентски файлове и имейл. */
(() => {
  'use strict';
  async function api(method, url, body, raw){
    const opt = { method, headers: { 'x-fb': '1' }, credentials: 'same-origin' };
    if (body !== undefined){ if (raw) opt.body = body; else { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; } }
    let r;
    try { r = await fetch(url, opt); } catch (e) { throw { code: 'unavailable', message: 'няма връзка със сървъра' }; }
    if (r.status === 401){ location.href = '/login'; throw { code: 'revoked', message: 'сесията изтече' }; }
    if (!r.ok){ let j = {}; try { j = await r.json(); } catch (e) {} throw { code: j.error || (r.status === 400 ? 'invalid_argument' : 'unavailable'), message: j.message || ('грешка ' + r.status) }; }
    return raw === 'blob' ? r.blob() : r.json();
  }
  const meP = api('GET', '/api/me');
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapDoc = (id, data) => ({ id, exists: data != null, data: () => data, metadata: meta });
  const snapList = docs => ({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta });
  const subs = new Set();
  function subscribe(load, next, error){
    let stop = false;
    const run = async () => { if (stop) return; try { const v = await load(); if (!stop) next(v); } catch (e) { if (!stop && e.code === 'revoked' && error){ stop = true; error(e); } } };
    run(); const t = setInterval(run, 8000); subs.add(run);
    return () => { stop = true; clearInterval(t); subs.delete(run); };
  }
  const refresh = () => subs.forEach(f => f());
  const split = k => { const i = k.lastIndexOf('_'); return [k.slice(0, i), k.slice(i + 1)]; };
  const loadFirms = async () => snapList((await api('GET', '/api/firms')).map(f => { const id = f.id; const d = Object.assign({}, f); delete d.id; return snapDoc(id, d); }));
  /* Версията на всеки зареден период се връща при запис: ако колега е записал междувременно, сървърът отказва и нищо не се губи мълчаливо. */
  const ver = new Map();
  const loadPeriods = async per => snapList((await api('GET', '/api/periods?period=' + per)).map(x => { const k = x.firm + '_' + per; ver.set(k, Math.max(ver.get(k) || 0, x.version || 0)); return snapDoc(k, x.data); }));
  function docRef(p){
    const [coll, id] = p.split('/');
    const url = coll === 'firms' ? '/api/firms/' + id : coll === 'settings' ? '/api/kv/' + id : '/api/period/' + split(id).join('/');
    return { id, path: p,
      async get(){ if (coll === 'firms') throw { code: 'invalid_argument' }; const r = await api('GET', url); return snapDoc(id, r.exists ? r.data : undefined); },
      async set(data){
        if (coll !== 'periods'){ await api('PUT', url, { data }); return refresh(); }
        try { const r = await api('PUT', url, { data, version: ver.get(id) }); ver.set(id, r.version); } catch (e) { if (e.code === 'conflict') ver.delete(id); refresh(); throw e; }
        refresh(); },
      async delete(){ await api('DELETE', url); ver.delete(id); refresh(); } };
  }
  function query(coll, filter){
    const load = () => coll === 'firms' ? loadFirms() : filter && filter[0] === 'period' ? loadPeriods(filter[1]) : Promise.resolve(snapList([]));
    const self = { path: coll, where: (f, op, v) => query(coll, [f, v]), orderBy: () => self, limit: () => self, get: load,
      onSnapshot: (next, error) => subscribe(load, next, error), doc: id => docRef(coll + '/' + id) };
    return self;
  }
  const db = { doc: docRef, collection: c => query(c, null) };

  async function shrink(blob){
    const bmp = await createImageBitmap(blob).catch(() => { throw { code: 'image_rejected', message: 'файлът не е четимо изображение' }; });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.86));
    const u8 = new Uint8Array(await out.arrayBuffer()); let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { mime: 'image/jpeg', data: btoa(s) };
  }
  const sample = Object.assign(async () => { throw { code: 'invalid_request', message: 'използвайте sample.json' }; }, {
    limits: async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }),
    json: async (input, opts) => {
      const images = [];
      for (const b of [].concat((opts && opts.images) || []).slice(0, 5)) images.push(await shrink(b));
      return (await api('POST', '/api/ai', { prompt: String(input), images })).value;
    } });
  const downloads = { save: async ({ filename, data }) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' })); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); return { status: 'saved' }; } };
  const user = { canEdit: async () => true, isOwner: async () => true };

  window.FB = { me: null,
    inbox: () => api('GET', '/api/inbox'),
    file: async x => new File([await api('GET', '/api/files/' + x.id, undefined, 'blob')], x.name, { type: x.mime }),
    upload: async (firm, file) => (await api('POST', '/api/files?firm=' + encodeURIComponent(firm) + '&name=' + encodeURIComponent(file.name), file, true)).id,
    done: id => api('POST', '/api/files/' + id + '/done'),
    email: (firm, subject, text) => api('POST', '/api/email', { firm, subject, text }),
    resetPortal: async id => (await api('POST', '/api/firms/' + id + '/portal-reset')).portal,
    replies: () => api('GET', '/api/replies'),
    replyDone: id => api('POST', '/api/replies/' + id + '/done'),
    questions: () => api('GET', '/api/questions'),
    ask: (firm, period, tx, text) => api('POST', '/api/questions', { firm, period, tx, text }),
    closeQ: id => api('POST', '/api/questions/' + id + '/close'),
    users: () => api('GET', '/api/users'),
    addUser: (email, password) => api('POST', '/api/users', { email, password }),
    delUser: id => api('DELETE', '/api/users/' + id),
    password: (old, next) => api('POST', '/api/password', { old, next }),
    resendVerify: () => api('POST', '/api/verify/resend'),
    logout: async () => { try { await api('POST', '/api/logout'); } catch (e) {} location.href = '/login'; } };
  window.claude = { use: async name => {
    const me = await meP.catch(() => null); if (!me) return null;
    FB.me = me;
    return name === 'db' ? db : name === 'user' ? user : name === 'downloads' ? downloads : name === 'sample' ? (me.ai ? sample : null) : null;
  } };
})();
