// Drill result: compact, with inline tagging and solutions, and where the topic stands now.
import { store, kindOf } from '../store.js';
import { buildReport, clearAnalysisCache } from '../engine/report.js';
import { GROUPS, STATUS_LABEL } from '../engine/topics.js';
import { isAnswered } from '../engine/scoring.js';
import { TAGS, DRILL, THRESHOLDS } from '../config.js';
import { esc, pct, fix, signed, fmtDur, fmtDate, OPTION_KEYS, plural, toast } from '../ui.js';
import { icon } from '../icons.js';
import { questionStrip, stripLegend, quadrantBoard, insightCards, questionDetail, coverageNote } from './bxui.js';

const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.id, t.label]));

export function render(root, [sid]) {
  const s = store.session(sid);
  if (!s) { location.replace('#/'); return; }
  if (kindOf(s) !== 'drill') { location.replace(`#/report/${sid}`); return; }
  if (s.status !== 'done') { location.replace(`#/test/${sid}`); return; }
  const full = s.analytics === 'full';
  const open = new Set();
  const st = { sel: null };

  const draw = () => {
    const R = buildReport(s);
    const sc = R.score;
    const t = full ? R.map.find((x) => x.topic === s.drill.topic) : null;
    const prior = R.trend.prior;
    const mode = DRILL.modes[s.drill.mode] || DRILL.modes.normal;
    const row = (r) => {
      const res = r.correct === true ? 'ok' : r.correct === false ? 'no' : 'skip';
      const ans = (v) => (!isAnswered(v) ? 'blank' : r.type === 'mcq' ? OPTION_KEYS[v] : String(v));
      const ratio = r.visits ? r.timeSec / (r.expectedSec * s.drill.mult) : 0;
      return `<div class="dr-row ${open.has(r.qid) ? 'open' : ''}" data-q="${r.qid}">
        <div class="dr-main">
          <span class="res-dot ${res}"></span>
          <div class="dr-text"><b>Q${r.n}</b> <span class="muted">${esc(r.q.subtopic || r.topic)}</span><div class="small muted">Your answer <b>${esc(ans(r.final))}</b> · key <b>${esc(r.type === 'mcq' ? OPTION_KEYS[r.q.answer] : String(r.q.answer))}</b>${full && r.changes ? ` · ${plural(r.changes, 'change')}` : ''}</div></div>
          <div class="dr-time" data-tip="${esc(`${fmtDur(r.timeSec)} spent · target ${fmtDur(r.expectedSec * s.drill.mult)}`)}"><span class="dr-bar"><i class="${ratio > 1 ? 'over' : ''}" style="width:${Math.min(100, ratio * 100).toFixed(0)}%"></i></span><span class="mono small">${fmtDur(r.timeSec)}</span></div>
          ${full ? `<div class="tag-btns compact">${TAGS.map((tg) => `<button class="tag-btn ${s.tags[r.qid] === tg.id ? 'on' : ''}" data-tag="${tg.id}" data-qid="${r.qid}" aria-pressed="${s.tags[r.qid] === tg.id}">${tg.label}</button>`).join('')}</div>` : ''}
          <button class="btn sm ghost" data-open="${r.qid}">${open.has(r.qid) ? 'Hide' : 'Solution'}</button>
        </div>
        ${open.has(r.qid) ? `<div class="dr-detail"><div class="q-text small-q">${r.q.text}</div>
          ${r.type === 'mcq' ? `<ol class="detail-opts">${r.q.options.map((o, i) => `<li class="${i === r.q.answer ? 'key' : ''} ${String(r.final) === String(i) && i !== r.q.answer ? 'mine' : ''}"><b>${OPTION_KEYS[i]}</b><span>${o}</span>${i === r.q.answer ? '<em>Answer key</em>' : String(r.final) === String(i) ? '<em>Your answer</em>' : ''}</li>`).join('')}</ol>` : ''}
          ${r.solution ? `<div class="solution"><div class="eyebrow">Solution</div><div>${r.solution}</div></div>` : ''}</div>` : ''}
      </div>`;
    };
    root.innerHTML = `<div class="container narrow-wide">
      <a class="back-link" href="#/">${icon('back', { size: 14 })} Home</a>
      <div class="report-head">
        <div><div class="eyebrow">${esc(s.templateName)} · ${mode.label} · ${fmtDate(s.endedAt, { year: true })}</div><h1>Drill result</h1>
          <div class="row" style="gap:8px"><span class="chip ${full ? 'accent' : ''}">${full ? 'Full analytics' : 'Scores + time'}</span>${s.endReason === 'timeout' ? '<span class="chip warn">Time ran out</span>' : ''}</div></div>
        <div class="score-block"><div class="score-big">${sc.score < 0 ? '−' + Math.abs(sc.score) : sc.score}<small> / ${sc.max}</small></div><div class="small muted">${sc.correct} right · ${sc.wrong} wrong · ${sc.unattempted} blank</div></div>
      </div>
      <div class="stats report-stats">
        <div class="stat"><span class="label">Accuracy</span><span class="value">${pct(sc.accuracy)}</span><span class="sub">of ${sc.attempted} attempted</span></div>
        <div class="stat"><span class="label">Time</span><span class="value">${fmtDur(s.elapsedMs / 1000)}</span><span class="sub">of ${fmtDur(s.durationSec)} allowed</span></div>
        <div class="stat"><span class="label">Within target</span><span class="value">${R.rows.filter((r) => r.visits && r.timeSec <= r.expectedSec * s.drill.mult).length}<small class="muted" style="font-size:1rem">/${R.rows.filter((r) => r.visits).length}</small></span><span class="sub">questions in time</span></div>
        ${prior.length ? `<div class="stat"><span class="label">Last drill here</span><span class="value">${pct(prior[prior.length - 1].accuracy)}</span><span class="sub">accuracy on ${fmtDate(prior[prior.length - 1].at)}</span></div>` : ''}
      </div>

      ${R.bx?.enabled && R.bx.quads ? `<section class="bxsheet card" id="behaviour">
        <div class="bx-part"><div class="part-head"><span class="part-n display">§1</span><div><h2>Where you struggled</h2><p class="small muted mb0">Each square a question in this drill, shaded by how strained your face was. Tap one to see it second by second.</p></div></div>
          ${stripLegend()}${questionStrip(s, R.rows, { sel: st.sel })}<div id="bxdetail">${st.sel ? questionDetail(s, R.rows[st.sel - 1]) : ''}</div></div>
        <div class="bx-part"><div class="part-head"><span class="part-n display">§2</span><div><h2>Four kinds of question</h2></div></div>${quadrantBoard(R.bx, { compact: true })}</div>
        ${R.bx.insights.length ? `<div class="bx-part"><div class="part-head"><span class="part-n display">§3</span><div><h2>What your face showed</h2></div></div>${insightCards(R.bx, { max: 3 })}</div>` : ''}
        ${coverageNote(R.bx)}
      </section>` : ''}

      ${t ? `<section class="card mt topic-now">
        <div class="row between"><div><div class="eyebrow">Where ${esc(t.topic)} stands now</div>
          <div class="row" style="gap:8px"><span class="group-chip ${t.status === 'insufficient' ? 'g-none' : GROUPS[t.group]?.cls}"><i></i>${t.status === 'insufficient' ? 'Not grouped yet' : GROUPS[t.group]?.label}</span><span class="status-chip st-${t.status}">${STATUS_LABEL[t.status]}</span></div></div>
          <div class="tstats"><span>Across tests <b>${t.cum.correct}/${t.cum.n}</b> right</span><span>Time <b>${fix(t.cum.timeRatio, 1)}×</b> expected</span>${t.cum.meanF != null ? `<span>Friction <b>${signed(t.cum.meanF)}</b></span>` : ''}</div></div>
        <p class="small muted mb0" style="margin-top:8px">${t.status === 'insufficient' ? `${THRESHOLDS.minTopicQuestions - t.cum.n} more questions and this topic gets a group.` : t.group === 'fluent' ? 'Fluent across your tests. Keep it light.' : esc(GROUPS[t.group].action)}</p>
      </section>` : ''}

      <section class="card mt">
        <div class="card-head"><h2>Questions</h2><span class="small muted">${full ? 'tag each one: it tunes the analytics' : 'time vs target'}</span></div>
        <div class="dr-list">${R.rows.map(row).join('')}</div>
      </section>

      ${full && R.narrative?.length ? `<section class="card mt"><div class="card-head"><h3>${icon('sparkles', { size: 16, cls: 'h-ico' })} The written read</h3></div><div class="coach small">${R.narrative.slice(0, 3).map((p) => `<p>${p.replace(/<button[^>]*>|<\/button>/g, '')}</p>`).join('')}</div></section>` : ''}
      ${full && R.patterns?.length ? `<section class="card mt"><div class="card-head"><h3>Patterns in this drill</h3></div>${R.patterns.map((p) => `<div class="pattern p-${p.id}"><h4>${esc(p.name)}</h4><p>${esc(p.headline)}</p></div>`).join('')}</section>` : ''}

      <div class="row mt" style="justify-content:flex-end;gap:10px">
        <a class="btn" href="#/mistakes">${icon('bookmark', { size: 14 })} Mistake log</a>
        ${s.drill.topic ? `<a class="btn primary" href="#/drill/${encodeURIComponent(s.drill.topic)}/${s.drill.mode}">${icon('refresh', { size: 14 })} Drill again</a>` : `<a class="btn primary" href="#/drill/mistakes/normal">${icon('refresh', { size: 14 })} Re-attempt again</a>`}
      </div>
    </div>`;
  };
  draw();

  root.onclick = (e) => {
    const bq = e.target.closest('.bxq, .qlink');
    if (bq?.dataset.q) { const n = Number(bq.dataset.q); st.sel = st.sel === n && bq.classList.contains('bxq') ? null : n; draw(); root.querySelector('#bxdetail')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (e.target.closest('[data-close]')) { st.sel = null; draw(); return; }
    const tb = e.target.closest('.tag-btn');
    if (tb) {
      s.tags[tb.dataset.qid] = tb.dataset.tag;
      store.putSession(s, { immediate: true });
      clearAnalysisCache();
      draw();
      return;
    }
    const o = e.target.closest('[data-open]');
    if (o) { const id = o.dataset.open; if (open.has(id)) open.delete(id); else open.add(id); draw(); }
  };
}
