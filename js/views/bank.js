// Question bank: both banks, tags, empirical stats, quality loop and the teacher tag-approval queue.
import { store } from '../store.js';
import { BANK } from '../data/bank.js';
import { EMPIRICAL } from '../data/cohort.js';
import { TAXONOMY_VERSION, SUBJECTS } from '../data/taxonomy.js';
import { expectedFor } from '../engine/paper.js';
import { DIFFICULTY_LABEL, THRESHOLDS, BANKS } from '../config.js';
import { esc, plain, pct, fmtDur, OPTION_KEYS, hashStr, toast } from '../ui.js';

// Stand-in for the LLM tag suggester: proposes a concept tag from the item's own topic,
// which a teacher must approve before it is used.
const TOPIC_CONCEPTS = {
  'Projectile Motion': ['equations of motion', 'resolution of velocity', 'time of flight'],
  'Rotational Dynamics': ['moment of inertia', 'torque and angular acceleration', 'rolling without slipping'],
  'DC Circuits': ['Kirchhoff’s laws', 'equivalent resistance', 'power dissipation'],
  'Mole Concept': ['limiting reagent', 'percentage composition', 'molar volume at STP'],
  'Chemical Equilibrium': ['Le Chatelier’s principle', 'Kp–Kc relation', 'degree of dissociation'],
  'General Organic Chemistry': ['inductive effect', 'hyperconjugation', 'carbocation stability'],
  'Quadratic Equations': ['nature of roots', 'sum and product of roots', 'location of roots'],
  'Definite Integrals': ['properties of definite integrals', 'King’s property', 'area under a curve'],
  'Probability': ['conditional probability', 'complementary events', 'binomial distribution'],
  'Cell Cycle and Cell Division': ['stages of meiosis I', 'mitotic phases', 'crossing over'],
  'Photosynthesis': ['Calvin cycle', 'light reactions', 'C4 pathway'],
  'Principles of Inheritance': ['Mendelian ratios', 'sex-linked inheritance', 'incomplete dominance'],
  'Body Fluids and Circulation': ['cardiac cycle', 'ECG waves', 'ABO blood groups'],
  'Breathing and Exchange of Gases': ['transport of gases', 'respiratory volumes', 'oxygen dissociation curve'],
  'Human Reproduction': ['gametogenesis', 'menstrual cycle hormones', 'fertilisation and implantation'],
};
const suggestion = (q) => {
  if (hashStr(q.id + 'sugg') % 5 !== 0) return null;
  const have = new Set(q.concepts.map((c) => c.toLowerCase()));
  const options = (TOPIC_CONCEPTS[q.topic] || []).filter((c) => !have.has(c.toLowerCase()));
  return options.length ? options[hashStr(q.id) % options.length] : null;
};

export function render(root, params, query = '') {
  const p = store.profile;
  const q0 = new URLSearchParams(query).get('q') || '';
  const st = { bank: q0.startsWith('C10-') ? 'class10' : q0.startsWith('E-') ? 'easy' : 'standard', subject: 'All', type: 'all', review: false, q: q0, open: null };
  const exam = p.exam;

  const tableHTML = () => {
    const src = BANK[st.bank];
    const list = src.filter((q) =>
      (st.subject === 'All' || q.subject === st.subject) &&
      (st.type === 'all' || q.type === st.type) &&
      (!st.review || EMPIRICAL[q.exams.includes(exam) ? exam : q.exams[0]]?.[q.id]?.flag) &&
      (!st.q || `${q.id} ${q.topic} ${q.subtopic} ${plain(q.text)}`.toLowerCase().includes(st.q.toLowerCase())));
    return `<table class="table bank-q">
      <thead><tr><th>ID</th><th>Topic · subtopic</th><th>Difficulty</th><th class="r">Expected (${exam})</th><th class="r">Attempts</th><th class="r">p(correct)</th><th>Quality</th></tr></thead>
      <tbody>${list.map((q) => {
        const ex = q.exams.includes(exam) ? exam : q.exams[0];
        const emp = EMPIRICAL[ex][q.id];
        const tpl = store.templates().find((t) => t.exam === ex && t.kind === 'full');
        const e = expectedFor(q, tpl);
        const open = st.open === q.id;
        const dec = store.tagDecision(q.id);
        return `<tr class="bq-row ${open ? 'open' : ''}" data-open="${q.id}"><td class="mono small">${q.id}${q.exams.includes(exam) ? '' : `<div class="faint">${q.exams.join('/')}</div>`}</td>
          <td><b>${esc(q.topic)}</b><div class="small muted">${esc(q.subtopic)} · ${q.type === 'mcq' ? 'MCQ' : 'Numerical'}</div></td>
          <td><span class="diff d${q.difficulty}">${DIFFICULTY_LABEL[q.difficulty]}</span></td>
          <td class="r num">${fmtDur(e.sec)}<div class="small faint">${e.source === 'empirical' ? 'median of correct' : 'template'}</div></td>
          <td class="r num">${emp.attempts}</td><td class="r num">${pct(emp.pCorrect)}</td>
          <td>${emp.flag ? `<span class="chip warn" data-tip="${esc(emp.flag.note)}">Back to teacher</span>` : '<span class="faint small">OK</span>'}</td></tr>
          ${open ? `<tr class="bq-detail"><td colspan="7"><div class="bq-text q-text">${q.text}</div>
            ${q.type === 'mcq' ? `<ol class="detail-opts">${q.options.map((o, i) => `<li class="${i === q.answer ? 'key' : ''} ${emp.flag?.option === i ? 'mine' : ''}"><b>${OPTION_KEYS[i]}</b><span>${o}</span>${i === q.answer ? '<em>Key</em>' : emp.flag?.option === i ? `<em>${emp.flag.share}% of top quartile</em>` : ''}</li>`).join('')}</ol>` : `<p>Key: <b class="mono">${q.answer}</b>${q.tolerance ? ` ± ${q.tolerance}` : ''}</p>`}
            ${q.solution ? `<div class="solution"><div class="eyebrow">Solution</div><div>${q.solution}</div></div>` : ''}
            <div class="row small" style="gap:6px;margin-top:8px">${q.concepts.map((c) => `<span class="chip">${c}</span>`).join('')}${dec?.v === 'approved' ? `<span class="chip good">${esc(dec.tag)} · approved</span>` : ''}</div>
            <p class="small faint mb0" style="margin-top:8px">${esc(q.chapter)} · Source: ${esc(q.source)} · Licence: ${esc(q.licence)}</p></td></tr>` : ''}`;
      }).join('') || '<tr><td colspan="7" class="muted">No items match.</td></tr>'}</tbody>
    </table>`;
  };

  const draw = () => {
    const src = BANK[st.bank];
    const flagged = src.filter((q) => q.exams.some((ex) => EMPIRICAL[ex][q.id]?.flag));
    const queue = BANK.standard.map((q) => ({ q, tag: suggestion(q) })).filter((x) => x.tag && !store.tagDecision(x.q.id));
    const decided = Object.keys(store.state.tagDecisions).length;
    root.innerHTML = `<div class="container">
      <div class="page-head"><div><div class="eyebrow">Content · ${esc(TAXONOMY_VERSION)}</div><h1>Question bank</h1>
        <p class="muted">${BANK.standard.length} standard items and ${BANK.easy.length} test-drive items, each tagged subject → chapter → topic → subtopic, with teacher-set difficulty, type, concepts, a worked solution and licence.</p></div>
        <div class="seg" role="group" aria-label="Bank"><button class="${st.bank === 'standard' ? 'on' : ''}" data-bank="standard">${BANKS.standard.label}</button><button class="${st.bank === 'easy' ? 'on' : ''}" data-bank="easy">${BANKS.easy.label}</button><button class="${st.bank === 'class10' ? 'on' : ''}" data-bank="class10">${BANKS.class10.label}</button></div></div>

      <div class="grid three">
        <div class="card tight"><div class="stat"><span class="label">Items in this bank</span><span class="value">${src.length}</span><span class="sub">${src.filter((q) => q.type === 'numerical').length} numerical-value</span></div></div>
        <div class="card tight"><div class="stat"><span class="label">Back to a teacher</span><span class="value">${flagged.length}</span><span class="sub">odd statistics after ${THRESHOLDS.empiricalAttempts}+ attempts</span></div></div>
        <div class="card tight"><div class="stat"><span class="label">Tag suggestions</span><span class="value">${queue.length}</span><span class="sub">awaiting teacher approval · ${decided} decided</span></div></div>
      </div>

      ${queue.length && st.bank === 'standard' ? `<section class="card mt"><div class="card-head"><h2>Tag approval queue</h2><span class="small muted">A model suggests; a teacher approves every tag</span></div>
        <ul class="list-plain">${queue.slice(0, 5).map(({ q, tag }) => `<li class="row between"><div><span class="mono small">${q.id}</span> · ${esc(q.topic)}<div class="small muted">Suggested concept: <b>${esc(tag)}</b></div></div>
          <div class="row"><button class="btn sm" data-dec="${q.id}" data-v="rejected">Reject</button><button class="btn sm primary" data-dec="${q.id}" data-v="approved" data-tag="${esc(tag)}">Approve</button></div></li>`).join('')}</ul></section>` : ''}

      <section class="card mt">
        <div class="bank-filters">
          <div class="seg">${['All', ...Object.keys(SUBJECTS)].map((s) => `<button class="${st.subject === s ? 'on' : ''}" data-subj="${s}">${s}</button>`).join('')}</div>
          <select id="ftype" aria-label="Type"><option value="all">All types</option><option value="mcq" ${st.type === 'mcq' ? 'selected' : ''}>MCQ</option><option value="numerical" ${st.type === 'numerical' ? 'selected' : ''}>Numerical</option></select>
          <label class="check-row" style="margin:0"><input type="checkbox" id="frev" ${st.review ? 'checked' : ''}><span>Needs review only</span></label>
          <input type="text" id="fq" placeholder="Search ID, topic or text" value="${esc(st.q)}" style="max-width:260px" autocomplete="off">
        </div>
        <div class="table-wrap mt" id="banktable">${tableHTML()}</div>
      </section>
      <p class="small faint mt">Attempt statistics are synthetic for the prototype. After about ${THRESHOLDS.empiricalAttempts} attempts, an item’s median correct time replaces the template estimate.</p>
    </div>`;
    if (st.q && st.q.match(/^E?-?[A-Z]{3}-[A-Z]{3}-\d{2}$/i)) { st.open = src.find((q) => q.id.toLowerCase() === st.q.toLowerCase())?.id || null; if (st.open) root.querySelector('#banktable').innerHTML = tableHTML(); }
  };
  const redrawTable = () => { const t = root.querySelector('#banktable'); if (t) t.innerHTML = tableHTML(); };
  draw();

  root.onclick = (e) => {
    const b = e.target.closest('[data-bank]'); if (b) { st.bank = b.dataset.bank; st.open = null; draw(); return; }
    const s = e.target.closest('[data-subj]'); if (s) { st.subject = s.dataset.subj; draw(); return; }
    const d = e.target.closest('[data-dec]');
    if (d) { store.setTagDecision(d.dataset.dec, { v: d.dataset.v, tag: d.dataset.tag || null, at: Date.now() }); toast(d.dataset.v === 'approved' ? 'Tag approved' : 'Suggestion rejected'); draw(); return; }
    const o = e.target.closest('[data-open]');
    if (o) { st.open = st.open === o.dataset.open ? null : o.dataset.open; redrawTable(); }
  };
  root.onchange = (e) => {
    if (e.target.id === 'ftype') { st.type = e.target.value; redrawTable(); }
    if (e.target.id === 'frev') { st.review = e.target.checked; redrawTable(); }
  };
  let searchTimer = null;
  root.oninput = (e) => {
    if (e.target.id === 'fq') { st.q = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(redrawTable, 120); }
  };
  return () => clearTimeout(searchTimer);
}
