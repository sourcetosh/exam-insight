// App shell + hash router.
import { store } from './store.js';
import { installTooltips, esc, toast, modal } from './ui.js';
import { icon, LOGO } from './icons.js';
import { applyTheme, cycleTheme, effectiveTheme } from './theme.js';
import { pwa } from './pwa.js';
import { installPalette } from './views/palette.js';
import { loadDemo } from './engine/simulate.js';
import * as home from './views/home.js';
import * as onboarding from './views/onboarding.js';
import * as start from './views/start.js';
import * as calibrate from './views/calibrate.js';
import * as room from './views/room.js';
import * as runner from './views/runner.js';
import * as review from './views/review.js';
import * as report from './views/report.js';
import * as drill from './views/drill.js';
import * as drillresult from './views/drillresult.js';
import * as mistakes from './views/mistakes.js';
import * as history from './views/history.js';
import * as templates from './views/templates.js';
import * as bank from './views/bank.js';
import * as methods from './views/methods.js';
import * as privacy from './views/privacy.js';
import * as settings from './views/settings.js';

const NAV = [
  { href: '#/', label: 'Home', match: /^#\/$/ },
  { href: '#/history', label: 'Progress', match: /^#\/(history|report|drillresult)/ },
  { href: '#/mistakes', label: 'Mistakes', match: /^#\/mistakes/ },
];
const MORE = [
  { href: '#/mentor', label: 'Mentor workspace', icon: 'users' },
  { href: '#/templates', label: 'Exam templates', icon: 'layers' },
  { href: '#/bank', label: 'Question bank', icon: 'book' },
  { href: '#/methods', label: 'How it works', icon: 'help' },
];

function lazyMentor(name) {
  return {
    render(root, params, query) {
      let out = null;
      let gone = false;
      root.innerHTML = '<div class="container mentor"><p class="muted">Opening the mentor workspace…</p></div>';
      import('./views/mentor.js').then((mod) => {
        if (gone) return;
        out = mod[name](root, params, query);
        const h1 = root.querySelector('h1');
        if (h1) document.title = `${h1.textContent.trim()} · Mentor · Exam Insight`;
      }).catch((e) => { console.error(e); root.innerHTML = '<div class="container"><p class="muted">The mentor workspace could not load.</p></div>'; });
      return () => { gone = true; if (typeof out === 'function') out(); };
    },
  };
}

// [pattern, view, { bare: hide shell, open: no profile needed, mentor: mentor header }]
const ROUTES = [
  [/^#\/$/, home],
  [/^#\/welcome$/, onboarding, { open: true, bare: true }],
  [/^#\/start\/([\w-]+)$/, start],
  [/^#\/calibrate\/([\w-]+)$/, calibrate, { bare: true }],
  [/^#\/room\/([\w-]+)$/, room, { bare: true }],
  [/^#\/room$/, room, { bare: true }],
  // v4 routes now lead to the camera room.
  [/^#\/precheck\/([\w-]+)$/, { render: (_r, [sid]) => location.replace(`#/room/${sid}`) }, { bare: true }],
  [/^#\/enrol$/, { render: (_r, _p, q) => { const n = new URLSearchParams(q || '').get('next') || ''; location.replace(`#/room?calibrate=1${n ? `&next=${encodeURIComponent(n)}` : ''}`); } }, { bare: true }],
  [/^#\/test\/([\w-]+)$/, runner, { bare: true }],
  [/^#\/review\/([\w-]+)$/, review],
  [/^#\/report\/([\w-]+)$/, report],
  [/^#\/drill\/([^/]+)\/([\w-]+)$/, drill],
  [/^#\/drillresult\/([\w-]+)$/, drillresult],
  [/^#\/mistakes$/, mistakes],
  [/^#\/history$/, history],
  [/^#\/coach$/, { render: () => location.replace('#/mentor') }],
  // Mentor workspace: its own header; the code loads only when a mentor page opens.
  [/^#\/mentor$/, lazyMentor('renderReteach'), { mentor: true, open: true }],
  [/^#\/mentor\/q\/([\w-]+)\/(\d+)\/([^/]+)$/, lazyMentor('renderTeach'), { mentor: true, open: true }],
  [/^#\/mentor\/students$/, lazyMentor('renderStudents'), { mentor: true, open: true }],
  [/^#\/mentor\/student\/([\w-]+)$/, lazyMentor('renderStudent'), { mentor: true, open: true }],
  [/^#\/mentor\/assignments$/, lazyMentor('renderAssignments'), { mentor: true, open: true }],
  [/^#\/templates$/, templates],
  [/^#\/bank$/, bank],
  [/^#\/methods$/, methods, { open: true }],
  [/^#\/privacy$/, privacy, { open: true }],
  [/^#\/settings$/, settings],
];

const app = document.getElementById('app');
let cleanup = null;


function shell(hash) {
  const p = store.profile;
  const nav = NAV.map((n) => `<a href="${n.href}" class="${n.match.test(hash) ? 'active' : ''}">${n.label}</a>`).join('');
  const moreActive = MORE.some((m) => hash.startsWith(m.href));
  const days = p?.examDate ? Math.ceil((new Date(p.examDate) - Date.now()) / 86400000) : null;
  const initial = (p?.name || 'S').trim().charAt(0).toUpperCase();
  return `<header class="topbar">
      <a class="brand" href="#/"><span class="brand-mark">${LOGO}</span><span class="brand-name">Exam <i>Insight</i></span></a>
      <nav class="nav" aria-label="Main">${nav}
        <div class="dd"><button class="nav-btn ${moreActive ? 'active' : ''}" aria-haspopup="true" aria-expanded="false">More ${icon('chevron', { size: 14 })}</button>
          <div class="dd-menu" role="menu">${MORE.map((m) => `<a role="menuitem" href="${m.href}">${icon(m.icon, { size: 16 })}${m.label}</a>`).join('')}</div></div>
      </nav>
      <div class="topbar-right">
        ${days != null && days >= 0 ? `<a class="chip countdown" href="#/settings" data-tip="${esc(`${p.exam === 'JEE' ? 'JEE Main' : 'NEET UG'} on ${new Date(p.examDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`)}">${icon('calendar', { size: 13 })} ${days} day${days === 1 ? '' : 's'}</a>` : ''}
        <span class="status-pill off" id="offline" ${navigator.onLine ? 'hidden' : ''}>${icon('offline', { size: 13 })} Offline</span>
        <button class="icon-btn" id="palbtn" data-tip="Search &amp; commands · Ctrl K" aria-label="Search and commands">${icon('search', { size: 18 })}</button>
        <button class="icon-btn" id="themebtn" data-tip="Theme" aria-label="Toggle theme">${icon(effectiveTheme() === 'dark' ? 'moon' : 'sun', { size: 18 })}</button>
        ${p ? `<div class="dd right"><button class="avatar" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${esc(initial)}</button>
          <div class="dd-menu" role="menu">
            <div class="dd-head"><b>${esc(p.name || 'Student')}</b><span class="small muted">${p.exam === 'JEE' ? 'JEE Main' : 'NEET UG'} · ${p.ageBand === 'u18' ? 'under 18' : '18+'}${p.demo ? ' · demo' : ''}</span></div>
            <a role="menuitem" href="#/settings">${icon('settings', { size: 16 })}Settings</a>
            <a role="menuitem" href="#/privacy">${icon('shield', { size: 16 })}Privacy &amp; data</a>
            <a role="menuitem" href="#/mentor">${icon('users', { size: 16 })}Mentor workspace</a>
            <button role="menuitem" data-act="help">${icon('keyboard', { size: 16 })}Keyboard shortcuts</button>
            <div class="dd-sep"></div>
            <button role="menuitem" data-act="demo" data-exam="JEE">${icon('sparkles', { size: 16 })}Load JEE sample data</button>
            <button role="menuitem" data-act="demo" data-exam="NEET">${icon('sparkles', { size: 16 })}Load NEET sample data</button>
            <div class="dd-sep"></div>
            <button role="menuitem" class="danger" data-act="reset">${icon('logout', { size: 16 })}Reset app</button>
          </div></div>` : `<a class="btn sm primary" href="#/welcome">Get started</a>`}
      </div>
    </header>
    <main id="view"></main>
    <nav class="tabbar" aria-label="Main (mobile)">
      ${[['#/', 'Home', 'home', /^#\/$/], ['#/history', 'Progress', 'trend', /^#\/(history|report|drillresult)/], ['#/mistakes', 'Mistakes', 'bookmark', /^#\/mistakes/], ['#/mentor', 'Mentor', 'users', /^#\/mentor/], ['#/settings', 'More', 'more', /^#\/(settings|privacy|templates|bank|methods)/]]
        .map(([href, label, ic, re]) => `<a href="${href}" class="${re.test(hash) ? 'active' : ''}">${icon(ic, { size: 20 })}<span>${label}</span></a>`).join('')}
    </nav>`;
}

function mentorShell(hash) {
  const items = [['#/mentor', 'Re-teach', /^#\/mentor($|\/q\/)/, 'target'], ['#/mentor/students', 'Students', /^#\/mentor\/(students|student)/, 'users'], ['#/mentor/assignments', 'Assignments', /^#\/mentor\/assignments/, 'list']];
  return `<header class="topbar mentor-bar">
      <a class="brand" href="#/mentor"><span class="brand-mark">${LOGO}</span><span class="brand-name">Exam <i>Insight</i></span><span class="brand-role">Mentor</span></a>
      <nav class="nav" aria-label="Mentor">${items.map(([h, l, re]) => `<a href="${h}" class="${re.test(hash) ? 'active' : ''}">${l}</a>`).join('')}</nav>
      <div class="topbar-right">
        <button class="icon-btn" id="themebtn" data-tip="Theme" aria-label="Toggle theme">${icon(effectiveTheme() === 'dark' ? 'moon' : 'sun', { size: 18 })}</button>
        <a class="btn sm" href="#/">${icon('back', { size: 14 })} Student app</a>
      </div>
    </header>
    <main id="view"></main>
    <nav class="tabbar" aria-label="Mentor (mobile)">
      ${[...items, ['#/', 'Student', /^$/, 'home']].map(([h, l, re, ic]) => `<a href="${h}" class="${re.test(hash) ? 'active' : ''}">${icon(ic, { size: 20 })}<span>${l}</span></a>`).join('')}
    </nav>`;
}

function parseHash() {
  const raw = location.hash || '#/';
  const i = raw.indexOf('?');
  return { path: i >= 0 ? raw.slice(0, i) : raw, query: i >= 0 ? raw.slice(i + 1) : '' };
}

function route() {
  const { path, query } = parseHash();
  for (const [re, view, opts = {}] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    if (!opts.open && !store.profile) { location.replace('#/welcome'); return; }
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
    cleanup = null;
    document.querySelectorAll('.pal-back, .modal-back').forEach((el) => el.remove());
    document.body.classList.toggle('bare', !!opts.bare);
    app.innerHTML = opts.bare ? '<main id="view"></main>' : opts.mentor ? mentorShell(path) : shell(path);
    const root = document.getElementById('view');
    root.classList.add('view-in');
    window.scrollTo(0, 0);
    const out = view.render(root, m.slice(1), query);
    cleanup = typeof out === 'function' ? out : null;
    const h1 = root.querySelector('h1');
    document.title = h1 ? `${h1.textContent.trim()} · Exam Insight` : 'Exam Insight';
    return;
  }
  location.replace('#/');
}

// ---------- shell interactions ----------
const demo = async (exam) => {
  const ok = !store.profile || await modal({ title: `Load the ${exam} sample data?`, body: '<p class="muted">This replaces everything saved in this browser with a sample student who has four past mocks and a drill.</p>', buttons: [{ label: 'Cancel', value: false }, { label: 'Load sample', value: true, cls: 'primary' }] });
  if (!ok) return;
  loadDemo(exam);
  applyTheme();
  location.hash = '#/';
  route();
  toast(`${exam} sample loaded: four past mocks and a drill`);
};
const palette = installPalette({ onDemo: demo });

document.addEventListener('click', async (e) => {
  const ddBtn = e.target.closest('.dd > button');
  if (ddBtn) {
    const dd = ddBtn.parentElement;
    const open = !dd.classList.contains('open');
    document.querySelectorAll('.dd.open').forEach((x) => { x.classList.remove('open'); x.querySelector('button').setAttribute('aria-expanded', 'false'); });
    dd.classList.toggle('open', open);
    ddBtn.setAttribute('aria-expanded', String(open));
    return;
  }
  if (!e.target.closest('.dd')) document.querySelectorAll('.dd.open').forEach((x) => { x.classList.remove('open'); x.querySelector('button').setAttribute('aria-expanded', 'false'); });
  if (e.target.closest('#palbtn')) { palette.open(); return; }
  if (e.target.closest('#themebtn')) {
    const next = cycleTheme();
    const btn = e.target.closest('#themebtn');
    btn.innerHTML = icon(effectiveTheme() === 'dark' ? 'moon' : 'sun', { size: 18 });
    toast(`Theme: ${next}`);
    return;
  }
  const act = e.target.closest('[data-act]');
  if (act?.dataset.act === 'help') palette.help();
  else if (act?.dataset.act === 'demo') demo(act.dataset.exam);
  else if (act?.dataset.act === 'reset') {
    const ok = await modal({ title: 'Reset the app?', body: '<p class="muted">Your profile, every test, all tags and notes will be removed from this browser. This cannot be undone.</p>', buttons: [{ label: 'Cancel', value: false }, { label: 'Reset', value: true, cls: 'danger' }] });
    if (ok) { store.reset(); applyTheme(); location.hash = '#/welcome'; route(); }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.dd.open').forEach((x) => x.classList.remove('open')); });
const onNet = () => { const el = document.getElementById('offline'); if (el) el.hidden = navigator.onLine; if (navigator.onLine) store.flushOutbox(); };
window.addEventListener('online', onNet);
window.addEventListener('offline', onNet);
window.addEventListener('ei:update', () => toast('A new version is ready. Reload to update.', 5000));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { const btn = document.getElementById('themebtn'); if (btn) btn.innerHTML = icon(effectiveTheme() === 'dark' ? 'moon' : 'sun', { size: 18 }); });

applyTheme();
window.addEventListener('hashchange', route);
installTooltips();
route();
