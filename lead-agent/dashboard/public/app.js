"use strict";
const $ = (id) => document.getElementById(id);
let leads = [];

function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dateOf(l) { return l.postedAt || l.collectedAt; }
function td(text, cls) { const c = document.createElement("td"); c.textContent = text; if (cls) c.className = cls; return c; }
function fillSelect(sel, values) {
  const cur = sel.value;
  sel.length = 1;
  for (const v of [...new Set(values)].filter(Boolean).sort()) {
    const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o);
  }
  sel.value = cur;
}
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; }
}

function render() {
  const m = $("f-market").value, n = $("f-niche").value, s = $("f-source").value;
  const from = $("f-from").value, to = $("f-to").value, q = $("f-q").value.trim().toLowerCase();
  const rows = leads.filter((l) => {
    if (m && l.market !== m) return false;
    if (n && l.niche !== n) return false;
    if (s && l.source !== s) return false;
    const day = fmt(dateOf(l)).slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q && ![l.summary, l.location, l.author, l.sourceDetail].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  const body = $("rows");
  body.replaceChildren();
  for (const l of rows) {
    const tr = document.createElement("tr");
    tr.append(td(fmt(dateOf(l)), "nowrap"), td(l.source + (l.sourceDetail ? " · " + l.sourceDetail : "")), td(l.market.toUpperCase()), td(l.niche), td(l.location), td(l.summary, "need"), td(l.author));
    const cell = document.createElement("td");
    const href = safeUrl(l.url);
    if (href) {
      const a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "open"; a.textContent = "Отвори публикацията";
      cell.appendChild(a);
    }
    tr.appendChild(cell);
    body.appendChild(tr);
  }
  $("count").textContent = `${rows.length} от ${leads.length} заявки`;
  $("empty").hidden = leads.length > 0;
}

async function load() {
  const [lr, sr] = await Promise.all([fetch("/api/leads"), fetch("/api/status")]);
  leads = await lr.json();
  const status = await sr.json();
  fillSelect($("f-market"), leads.map((l) => l.market));
  fillSelect($("f-niche"), leads.map((l) => l.niche));
  fillSelect($("f-source"), leads.map((l) => l.source));
  const st = $("status");
  st.replaceChildren();
  if (status) {
    st.append(`Последно пускане: ${fmt(status.finishedAt)} · нови: ${status.added} `);
    for (const [name, info] of Object.entries(status.sources)) {
      if (info.status === "login_required" || info.status === "captcha" || info.status === "error") {
        const b = document.createElement("span");
        b.className = info.status === "error" ? "bad" : "warn";
        b.textContent = ` · ${name}: ${info.message || info.status}`;
        st.appendChild(b);
      }
    }
  }
  render();
}

for (const id of ["f-market", "f-niche", "f-source", "f-from", "f-to", "f-q"]) $(id).addEventListener("input", render);
$("f-reset").addEventListener("click", () => {
  for (const id of ["f-market", "f-niche", "f-source", "f-from", "f-to", "f-q"]) $(id).value = "";
  render();
});
load();
