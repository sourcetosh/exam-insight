// Exam template editor. Formats are data, so a bulletin change is an edit, not a release.
import { store } from '../store.js';
import { SUBJECTS } from '../data/taxonomy.js';
import { DEFAULT_TEMPLATES, questionCount, maxMarks, secPerQ } from '../data/templates.js';
import { bankCoverage } from '../engine/paper.js';
import { esc, toast, modal, fmtDur } from '../ui.js';

const STATUS = {
  'needs-check': { label: 'Check against bulletin', cls: 'warn' },
  verified: { label: 'Verified', cls: 'good' },
  derived: { label: 'Practice format', cls: '' },
  'not-configured': { label: 'Not configured', cls: 'bad' },
};

export function render(root) {
  let selId = store.templates().find((t) => t.exam === store.profile.exam)?.id || 'jee-mini';
  let draft = null;
  let dirty = false;

  const load = (id) => {
    selId = id;
    const t = store.template(id);
    draft = JSON.parse(JSON.stringify(t));
    delete draft.overridden;
    dirty = false;
  };
  load(selId);

  const draw = () => {
    const list = store.templates();
    const t = draft;
    const n = questionCount(t);
    const cov = bankCoverage(t);
    const subjects = Object.keys(SUBJECTS).filter((s) => SUBJECTS[s].exams.includes(t.exam));
    const vs = STATUS[t.verification?.status] || STATUS.derived;
    root.innerHTML = `<div class="container">
      <div class="page-head"><div><div class="eyebrow">Admin</div><h1>Exam templates</h1>
        <p class="muted">Official patterns change and sources disagree, so formats live here, not in code. Check each against the current NTA bulletin before an exam cycle.</p></div></div>
      <div class="tpl-layout">
        <nav class="tpl-list card" aria-label="Templates">
          ${['JEE', 'NEET'].map((ex) => `<div class="eyebrow" style="margin:6px 8px">${ex === 'JEE' ? 'JEE' : 'NEET'}</div>${list.filter((x) => x.exam === ex).map((x) => `<button class="tpl-item ${x.id === selId ? 'on' : ''}" data-sel="${x.id}">
            <span>${esc(x.name)}</span><span class="row" style="gap:4px">${x.overridden ? '<span class="dot" style="color:var(--accent)" data-tip="Edited"></span>' : ''}<span class="chip ${STATUS[x.verification?.status]?.cls || ''}">${STATUS[x.verification?.status]?.label || ''}</span></span></button>`).join('')}`).join('')}
        </nav>
        <form class="card tpl-form" id="tf" autocomplete="off">
          <div class="row between"><div><h2 class="mb0">${esc(t.name)}</h2><span class="small muted">${t.exam} · ${t.layout === 'cbt' ? 'computer-based' : 'paper + OMR'} · id <span class="mono">${esc(t.id)}</span></span></div>
            <span class="chip ${vs.cls}">${vs.label}</span></div>
          ${t.verification?.notes?.length ? `<div class="notice ${t.verification.status === 'needs-check' ? 'warn' : 'calm'} mt"><span class="ico">⚑</span><div><b>Source notes</b><ul class="ticks small">${t.verification.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : ''}

          <div class="form-grid mt">
            <div class="field"><label for="f-name">Name</label><input id="f-name" data-f="name" type="text" value="${esc(t.name)}"></div>
            <div class="field"><label for="f-layout">Layout</label><select id="f-layout" data-f="layout"><option value="cbt" ${t.layout === 'cbt' ? 'selected' : ''}>Computer-based (palette)</option><option value="omr" ${t.layout === 'omr' ? 'selected' : ''}>Paper + OMR</option></select></div>
            <div class="field"><label for="f-min">Total time (min)</label><input id="f-min" data-f="totalMin" type="number" min="1" value="${t.totalMin}"></div>
            <div class="field"><label>Expected-time basis</label><div class="row" style="flex-wrap:nowrap"><input data-f="basis.minutes" type="number" min="1" value="${t.basis.minutes}" aria-label="Basis minutes"><span class="muted">min /</span><input data-f="basis.questions" type="number" min="1" value="${t.basis.questions}" aria-label="Basis questions"><span class="muted">Q</span></div>
              <span class="hint">${fmtDur(secPerQ(t))} per question before difficulty multipliers.</span></div>
          </div>

          <h3 class="mt">Sections</h3>
          <div class="table-wrap"><table class="table form-table"><thead><tr><th>Section</th><th>Subject</th><th class="r">MCQ</th><th class="r">Numerical</th><th class="r">Bank</th><th></th></tr></thead><tbody>
            ${t.sections.map((s, i) => `<tr>
              <td><input type="text" data-s="${i}:name" value="${esc(s.name)}" aria-label="Section name"></td>
              <td><select data-s="${i}:subject" aria-label="Subject">${subjects.map((x) => `<option ${x === s.subject ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
              <td class="r"><input type="number" min="0" data-s="${i}:mcq" value="${s.mcq}" aria-label="MCQ count"></td>
              <td class="r"><input type="number" min="0" data-s="${i}:numerical" value="${s.numerical}" aria-label="Numerical count"></td>
              <td class="r num">${cov[i] ? `<span class="${cov[i].have < cov[i].wanted ? 'warn-t' : 'good-t'}">${cov[i].have}/${cov[i].wanted}</span>` : ''}</td>
              <td class="r"><button type="button" class="btn sm ghost" data-del="${i}" aria-label="Remove section">✕</button></td></tr>`).join('')}
          </tbody></table></div>
          <button type="button" class="btn sm mt" id="addsec">+ Add section</button>

          <h3 class="mt">Marking</h3>
          <div class="table-wrap"><table class="table form-table"><thead><tr><th>Type</th><th class="r">Correct</th><th class="r">Wrong</th><th class="r">Unattempted</th></tr></thead><tbody>
            ${['mcq', 'numerical'].map((k) => `<tr><td>${k === 'mcq' ? 'Multiple choice' : 'Numerical value'}</td>${['correct', 'wrong', 'unattempted'].map((f) => `<td class="r"><input type="number" step="1" data-f="marking.${k}.${f}" value="${t.marking[k][f]}" aria-label="${k} ${f}"></td>`).join('')}</tr>`).join('')}
          </tbody></table></div>
          <div class="field mt"><label for="f-pm">Partial-marking rules</label><textarea id="f-pm" data-f="partialMarking" placeholder="e.g. multiple-correct: +1 per correct option chosen, −2 if any wrong option chosen">${esc(t.partialMarking || '')}</textarea></div>

          <h3 class="mt">Palette &amp; interface</h3>
          <label class="check-row"><input type="checkbox" data-f="palette.saveRequired" ${t.palette?.saveRequired ? 'checked' : ''}><span>Selections count only after <b>Save &amp; Next</b> (NTA behaviour)</span></label>
          <label class="check-row"><input type="checkbox" data-f="palette.fullscreen" ${t.palette?.fullscreen ? 'checked' : ''}><span>Ask for full screen at start</span></label>

          <h3 class="mt">Bulletin check</h3>
          <div class="form-grid">
            <div class="field"><label for="f-vs">Status</label><select id="f-vs" data-f="verification.status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${t.verification?.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
            <div class="field"><label for="f-vd">Checked on</label><input id="f-vd" type="date" data-f="verification.checkedOn" value="${t.verification?.checkedOn || ''}"></div>
            <div class="field"><label for="f-dis">Availability</label><select id="f-dis" data-f="disabled"><option value="" ${!t.disabled ? 'selected' : ''}>Students can start it</option><option value="1" ${t.disabled ? 'selected' : ''}>Hidden from students</option></select></div>
          </div>

          <div class="tpl-summary">
            <span><b>${n}</b> questions</span><span><b>${maxMarks(t)}</b> marks</span><span><b>${t.totalMin}</b> min</span>
            <span>${cov.reduce((a, c) => a + c.have, 0) < n ? `<span class="warn-t">Bank covers ${cov.reduce((a, c) => a + c.have, 0)} of ${n}</span>` : '<span class="good-t">Bank covers every slot</span>'}</span>
          </div>
          <div class="row between mt">
            <button type="button" class="btn ghost danger" id="reset" ${store.template(selId).overridden ? '' : 'disabled'}>Reset to default</button>
            <div class="row"><span class="small ${dirty ? 'warn-t' : 'faint'}" id="dirty">${dirty ? 'Unsaved changes' : 'No changes'}</span><button type="submit" class="btn primary">Save template</button></div>
          </div>
        </form>
      </div>
    </div>`;
  };

  const setPath = (obj, path, val) => {
    const ks = path.split('.');
    let o = obj;
    for (const k of ks.slice(0, -1)) o = o[k] ||= {};
    o[ks[ks.length - 1]] = val;
  };

  root.oninput = root.onchange = (e) => {
    const el = e.target;
    if (el.dataset.f) {
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      if (el.dataset.f === 'disabled') v = !!el.value;
      setPath(draft, el.dataset.f, v);
    } else if (el.dataset.s) {
      const [i, k] = el.dataset.s.split(':');
      draft.sections[i][k] = el.type === 'number' ? Math.max(0, Number(el.value)) : el.value;
    } else return;
    dirty = true;
    if (e.type === 'change') draw();
    else { const d = root.querySelector('#dirty'); if (d) { d.textContent = 'Unsaved changes'; d.className = 'small warn-t'; } }
  };
  root.onclick = async (e) => {
    const sel = e.target.closest('[data-sel]');
    if (sel) {
      if (dirty && !(await modal({ title: 'Discard changes?', body: '<p class="muted">You have unsaved edits to this template.</p>', buttons: [{ label: 'Keep editing', value: false }, { label: 'Discard', value: true, cls: 'danger' }] }))) return;
      load(sel.dataset.sel); draw(); return;
    }
    const del = e.target.closest('[data-del]');
    if (del) { draft.sections.splice(Number(del.dataset.del), 1); dirty = true; draw(); return; }
    if (e.target.id === 'addsec') {
      const subj = Object.keys(SUBJECTS).find((s) => SUBJECTS[s].exams.includes(draft.exam));
      draft.sections.push({ name: subj, subject: subj, mcq: 5, numerical: 0 });
      dirty = true; draw(); return;
    }
    if (e.target.id === 'reset') {
      if (await modal({ title: 'Reset to default?', body: '<p class="muted">Your edits to this template will be removed. Past reports are not affected.</p>', buttons: [{ label: 'Cancel', value: false }, { label: 'Reset', value: true, cls: 'danger' }] })) {
        store.resetTemplate(selId); load(selId); draw(); toast('Template reset');
      }
    }
  };
  root.onsubmit = (e) => {
    e.preventDefault();
    const base = DEFAULT_TEMPLATES.find((x) => x.id === selId);
    const { id, exam, kind, blurb, ...rest } = draft;
    store.saveTemplate(selId, { ...rest, exam: base.exam });
    load(selId); draw();
    toast('Template saved. New tests use it; past reports keep the version they were taken with.');
  };
  draw();
}
