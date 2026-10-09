// Small DOM, formatting and maths helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
/** Strip HTML from bank text for previews. */
export const plain = (html) => String(html ?? '').replace(/<sup>(.*?)<\/sup>/g, '^$1').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, (m) => {
  const t = document.createElement('textarea'); t.innerHTML = m; return t.value;
});

const pad = (n) => String(n).padStart(2, '0');
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
export function fmtDur(sec) {
  if (sec == null || isNaN(sec)) return '—';
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 10 && s) return `${m}m ${s}s`;
  if (m < 60) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export const pct = (x, d = 0) => (x == null || isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const fix = (x, d = 2) => (x == null || isNaN(x) ? '—' : x.toFixed(d));
export function signed(x, d = 2) {
  if (x == null || isNaN(x)) return '—';
  const r = Number(x.toFixed(d));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}`;
}
export function fmtDate(ts, opts = {}) {
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(opts.year ? { year: 'numeric' } : {}) });
}
export function relDay(ts) {
  const d = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return fmtDate(ts);
}
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ---------- maths ----------
export const sum = (a) => a.reduce((s, x) => s + x, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
}
export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Seeded PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, r = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---------- friction colour ----------
/** Map a friction value to one of six sequential steps (0 = calm, 5 = costly). */
export function fStep(F) {
  if (F == null || isNaN(F)) return null;
  if (F < -0.5) return 0;
  if (F < 0) return 1;
  if (F < 0.5) return 2;
  if (F < 1.0) return 3;
  if (F < 1.6) return 4;
  return 5;
}
export const F_STEPS = ['< −0.5', '−0.5–0', '0–0.5', '0.5–1', '1–1.6', '≥ 1.6'];

// ---------- feedback ----------
let toastTimer;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Promise-based modal. buttons: [{label, value, cls}] */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, cls: 'primary' }], dismissValue = null }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <h2 id="m-title">${title}</h2><div class="m-body">${body}</div>
      <div class="actions">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(dismissValue); } };
    back.addEventListener('click', (e) => {
      if (e.target === back) return done(dismissValue);
      const b = e.target.closest('[data-i]');
      if (b) done(buttons[+b.dataset.i].value);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    back.querySelector('.btn.primary, .btn')?.focus();
  });
}

// ---------- tooltips ----------
export function installTooltips() {
  const tip = document.getElementById('tip');
  let anchor = null;
  const place = () => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = clamp(x, 8, window.innerWidth - tw - 8);
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const show = (el) => { anchor = el; tip.innerHTML = el.dataset.tip; tip.hidden = false; place(); };
  const hide = () => { anchor = null; tip.hidden = true; };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[data-tip]');
    if (el && el !== anchor) show(el);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true);
}

export function download(filename, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const OPTION_KEYS = ['A', 'B', 'C', 'D'];
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
