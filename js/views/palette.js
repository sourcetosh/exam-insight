// Command palette (Ctrl/⌘ K) and the keyboard-shortcuts sheet (?).
import { store, kindOf } from '../store.js';
import { esc, relDay } from '../ui.js';
import { icon } from '../icons.js';
import { ALL_QUESTIONS } from '../data/bank.js';
import { topicsFor } from '../data/taxonomy.js';
import { cycleTheme } from '../theme.js';

const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;

export function installPalette({ onDemo }) {
  let overlay = null, input = null, listEl = null, items = [], shown = [], idx = 0;

  const buildItems = () => {
    const p = store.profile;
    const out = [];
    const page = (label, href, ic, keys = '') => out.push({ group: 'Pages', label, href, icon: ic, keys });
    page('Home', '#/', 'home', 'dashboard');
    page('Progress', '#/history', 'trend', 'history trend tests');
    page('Mistake log', '#/mistakes', 'bookmark', 'errors wrong notebook');
    page('Mentor workspace', '#/mentor', 'users', 're-teach, students, assignments');
    page('Exam templates', '#/templates', 'layers', 'formats bulletin');
    page('Question bank', '#/bank', 'book', 'items tags');
    page('How it works', '#/methods', 'help', 'method friction rules');
    page('Privacy', '#/privacy', 'shield', 'consent data export delete');
    page('Settings', '#/settings', 'settings', 'theme exam date bank');
    if (p) {
      for (const t of store.templates().filter((x) => x.exam === p.exam && !x.disabled)) out.push({ group: 'Start a mock', label: t.name, href: `#/start/${t.id}`, icon: 'play', keys: `start mock ${t.kind}` });
      for (const t of topicsFor(p.exam)) out.push({ group: 'Drill a topic', label: t.topic, href: `#/drill/${encodeURIComponent(t.topic)}/normal`, icon: 'zap', keys: `drill ${t.subject} ${t.chapter}` });
      out.push({ group: 'Drill a topic', label: 'Re-attempt open mistakes', href: '#/drill/mistakes/normal', icon: 'refresh', keys: 'mistakes drill' });
      for (const s of store.sessions({ status: 'done', exam: p.exam }).slice(-6).reverse()) {
        out.push({ group: 'Recent results', label: `${s.templateName} · ${relDay(s.endedAt || s.createdAt)}`, href: kindOf(s) === 'drill' ? `#/drillresult/${s.id}` : `#/report/${s.id}`, icon: 'chart', keys: 'report result' });
      }
    }
    out.push({ group: 'Actions', label: 'Toggle theme (system → light → dark)', action: () => cycleTheme(), icon: 'sun', keys: 'dark light mode' });
    out.push({ group: 'Actions', label: 'Keyboard shortcuts', action: () => showHelp(), icon: 'keyboard', keys: 'help keys' });
    out.push({ group: 'Actions', label: 'Load JEE sample data', action: () => onDemo('JEE'), icon: 'sparkles', keys: 'demo' });
    out.push({ group: 'Actions', label: 'Load NEET sample data', action: () => onDemo('NEET'), icon: 'sparkles', keys: 'demo' });
    return out;
  };

  const filter = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items.filter((x) => x.group !== 'Drill a topic' || words.length).slice(0, 14);
    const hit = (x) => { const h = `${x.label} ${x.keys || ''} ${x.group}`.toLowerCase(); return words.every((w) => h.includes(w)); };
    const res = items.filter(hit).slice(0, 12);
    if (q.length >= 3) {
      const ql = q.toLowerCase();
      for (const x of ALL_QUESTIONS) {
        if (res.length >= 18) break;
        if (x.id.toLowerCase().includes(ql) || x.text.toLowerCase().includes(ql)) res.push({ group: 'Questions', label: `${x.id} · ${x.text.replace(/<[^>]+>/g, '').slice(0, 70)}`, href: `#/bank?q=${encodeURIComponent(x.id)}`, icon: 'book' });
      }
    }
    return res;
  };

  const renderList = () => {
    let group = null;
    listEl.innerHTML = shown.length ? shown.map((x, i) => {
      const head = x.group !== group ? `<div class="pal-group">${esc(x.group)}</div>` : '';
      group = x.group;
      return `${head}<button class="pal-item ${i === idx ? 'on' : ''}" data-i="${i}" role="option" aria-selected="${i === idx}">${icon(x.icon || 'arrow', { size: 16 })}<span>${esc(x.label)}</span></button>`;
    }).join('') : '<div class="pal-empty">Nothing matches.</div>';
    listEl.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (x) => { close(); if (x.action) x.action(); else if (x.href) location.hash = x.href; };

  const open = () => {
    if (overlay) return;
    items = buildItems();
    overlay = document.createElement('div');
    overlay.className = 'pal-back';
    overlay.innerHTML = `<div class="pal" role="dialog" aria-label="Search and commands">
      <div class="pal-input">${icon('search', { size: 18 })}<input type="text" placeholder="Search pages, start a mock, drill a topic, find a question…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <div class="pal-list" role="listbox"></div>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>?</kbd> shortcuts</span></div></div>`;
    document.body.appendChild(overlay);
    input = overlay.querySelector('input');
    listEl = overlay.querySelector('.pal-list');
    shown = filter(''); idx = 0; renderList();
    input.focus();
    input.addEventListener('input', () => { shown = filter(input.value); idx = 0; renderList(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); renderList(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); renderList(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[idx]) run(shown[idx]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close();
      const b = e.target.closest('.pal-item');
      if (b) run(shown[Number(b.dataset.i)]);
    });
  };
  const close = () => { overlay?.remove(); overlay = null; };

  const showHelp = () => {
    const rows = [
      ['Everywhere', [['Ctrl / ⌘ K', 'Search and commands'], ['?', 'This sheet'], ['Esc', 'Close dialogs']]],
      ['Computer-based test', [['1 – 4 or A – D', 'Choose an option'], ['S or Enter', 'Save & next'], ['M', 'Mark for review & next'], ['C', 'Clear response'], ['← →', 'Previous / next question'], ['Digits', 'Type into a numerical answer from anywhere']]],
      ['Paper test (OMR)', [['1 – 4', 'Fill the bubble for the highlighted question']]],
      ['Report', [['Click a question number', 'Opens it on the timeline'], ['Hover the replay', 'See that moment']]],
    ];
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Keyboard shortcuts"><h2>Keyboard shortcuts</h2>
      ${rows.map(([g, r]) => `<div class="eyebrow mt">${g}</div><table class="table keys">${r.map(([k, d]) => `<tr><td class="r">${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' / ')}</td><td>${esc(d)}</td></tr>`).join('')}</table>`).join('')}
      <div class="actions"><button class="btn primary">Done</button></div></div>`;
    const done = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('.btn')) done(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    back.querySelector('.btn').focus();
  };

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); overlay ? close() : open(); return; }
    if (e.key === '?' && !isTyping(e) && !overlay && !document.querySelector('.modal-back') && !document.body.classList.contains('bare')) { e.preventDefault(); showHelp(); }
  });
  return { open, help: showHelp };
}
