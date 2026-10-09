// Privacy & data: consent choices, calibration, what is stored, export and delete.
import { store } from '../store.js';
import { POLICY } from '../config.js';
import { analyticsLevel, faceEnrolled } from '../engine/paper.js';
import { esc, fmtDate, toast, modal, download, plural } from '../ui.js';
import { faceLayer } from '../face/facelayer.js';

export function render(root) {
  const draw = () => {
    const p = store.profile;
    if (!p) {
      root.innerHTML = `<div class="container narrow"><h1>Privacy</h1><p class="muted">Nothing is stored yet. When you set up a profile, everything stays in this browser.</p><a class="btn primary" href="#/welcome">Get started</a></div>`;
      return;
    }
    const u18 = p.ageBand === 'u18';
    const level = analyticsLevel(p);
    const bytes = new Blob([store.exportAll()]).size;
    const tests = Object.keys(store.state.sessions).length;
    const pending = store.pendingSync();
    const toggle = (key, title, body, disabled = false) => `<div class="toggle-row"><div class="txt"><strong>${title}</strong><p>${body}</p></div>
      <label class="switch"><input type="checkbox" data-c="${key}" ${p.consent?.[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${esc(title)}"><span class="track"></span></label></div>`;

    root.innerHTML = `<div class="container narrow">
      <div class="eyebrow">Your data</div>
      <h1>Privacy</h1>
      <p class="muted">Everything below lives in this browser. Face processing happens in the page and only numbers are kept. You can change any choice; it applies from your next test.</p>

      <section class="card mt">
        <div class="card-head"><h2>Account</h2><span class="chip ${level === 'full' ? 'accent' : ''}">${level === 'full' ? 'Full analytics' : 'Scores + time per question'}</span></div>
        <div class="summary-list">
          <div><span>Name</span><b>${esc(p.name)}</b></div>
          <div><span>Age band</span><b>${u18 ? 'Under 18' : '18 or older'}</b></div>
          ${u18 ? `<div><span>Parental consent</span><b>${p.parental ? `Verified ${fmtDate(p.parental.at)} · ${esc(p.parental.method)}` : 'Missing'}</b></div>` : ''}
          ${p.demo ? '<div><span>Profile</span><b>Demo student (sample data)</b></div>' : ''}
        </div>
      </section>

      <section class="card mt">
        <h2>Choices</h2>
        ${u18 ? `<div class="notice calm"><span class="ico">ℹ︎</span><div>${p.parental ? 'These are the parent’s choices from setup. Changing them here counts as the parent’s decision. Nothing is uploaded either way.' : 'Parental consent is missing, so behaviour analytics and the camera stay off.'}</div></div>` : ''}
        ${toggle('camera', 'Camera-based behaviour analysis', 'Your face is read on this device during every test: strain per second against your calm face, and whether you were reading, writing or looking away. Tests need this; it is what the behaviour map is made of.', u18 && (!POLICY.UNDER18_CAMERA || !p.parental))}
        ${toggle('coach', 'Share with my mentor', 'Your mentor sees your results and behaviour maps, and can assign practice and leave notes.')}
        ${toggle('snapshots', 'Snapshot when something is flagged', 'One small photo when a phone or another person is seen, for your mentor to judge. Off unless you turn it on.')}
        ${toggle('sync', 'Back up numeric summaries', 'Queued for upload when online. No server in this prototype.')}
      </section>

      <section class="card mt">
        <div class="card-head"><h2>Face data</h2>${faceEnrolled(p) ? '<span class="chip good">Saved on this device</span>' : '<span class="chip">None</span>'}</div>
        <div class="row" style="align-items:flex-start;gap:18px">
          ${p.face?.thumb ? `<img class="face-thumb" src="${p.face.thumb}" alt="Your reference photo">` : ''}
          <div class="grow">
            <p class="muted small" style="margin-bottom:8px">${p.calibration?.v === 2
              ? `Calibrated ${fmtDate(p.calibration.at, { year: true })} in the camera room: your calm face (${p.calibration.neutral?.n || 0} frames), your own frown and lip-press range, your screen corners and writing posture.`
              : 'Not calibrated yet. The camera room learns your face before your first test (about two minutes).'}
            ${faceEnrolled(p) ? ` Admit-card photo and ${p.face.descriptors?.length || 0} face signatures (128 numbers each), used only to check it’s you.` : ''}</p>
            <div class="row">${p.consent?.camera ? `<a class="btn" href="#/room?calibrate=1&next=privacy">${p.calibration?.v === 2 ? 'Recalibrate' : 'Open the camera room'}</a>` : '<span class="small faint">Turn on camera-based analysis first.</span>'}
              ${faceEnrolled(p) || p.calibration ? '<button class="btn ghost danger" id="delface">Delete face data</button>' : ''}</div>
          </div>
        </div>
      </section>

      <section class="card mt">
        <h2>What is stored</h2>
        <div class="grid two">
          <div><div class="eyebrow">Kept on this device</div><ul class="ticks small">
            <li>Your answers and scores</li><li>A per-question event log (enter, leave, select, save, idle, tab focus)</li>
            <li>Self-report tags</li><li>Per second of each test: a strain number and whether you were reading, writing or looking away</li>
            <li>Per question: which facial actions carried the strain (brow, lips, eyes), as shares</li>
            <li>Your calibration: calm-face averages, your range, screen corners, writing posture</li>
            <li>Face signatures and one small admit-card photo, to check it’s you</li>
            <li>Proctoring notes, and with your consent one small photo per flag</li></ul></div>
          <div><div class="eyebrow">Never captured</div><ul class="ticks small">
            <li>Video or audio recordings</li><li>Your screen or other tabs</li><li>Emotion labels: strain is measured, feelings are not guessed</li><li>Anything uploaded: face data and notes stay here</li></ul></div>
        </div>
        <div class="summary-list mt">
          <div><span>Tests stored</span><b>${tests}</b></div>
          <div><span>Size</span><b>${(bytes / 1024).toFixed(1)} KB</b></div>
          <div><span>Waiting to sync</span><b>${p.consent?.sync ? plural(pending, 'summary', 'summaries') : 'Backup off'}</b></div>
        </div>
        <div class="row mt">
          <button class="btn" id="export">Export my data (JSON)</button>
          ${p.consent?.sync && pending ? '<button class="btn" id="sync">Sync now</button>' : ''}
          <div class="spacer"></div>
          <button class="btn danger" id="wipe">Delete everything</button>
        </div>
      </section>

      <section class="card mt flat">
        <h3>Legal basis, briefly</h3>
        <ul class="ticks small muted">
          <li>The DPDP Act treats anyone under 18 as a child: verifiable parental consent first, and no tracking, behavioural monitoring or targeted advertising directed at children.</li>
          <li>The consent, security and breach provisions apply from 13 May 2027. This prototype is built to them from day one.</li>
          <li>Parent verification uses identity data or a virtual token from an authorised entity such as a DigiLocker provider. Simulated here.</li>
        </ul>
      </section>
    </div>`;
  };
  draw();

  root.onchange = (e) => {
    const k = e.target.dataset.c;
    if (!k) return;
    const c = { ...store.profile.consent, [k]: e.target.checked, at: Date.now() };
    if (k === 'camera') c.behaviour = e.target.checked;
    if (!c.camera) faceLayer.stop();
    store.updateProfile({ consent: c });
    toast('Saved. Applies from your next test.');
    draw();
  };
  root.onclick = async (e) => {
    if (e.target.id === 'export') download(`exam-insight-${new Date().toISOString().slice(0, 10)}.json`, store.exportAll());
    if (e.target.id === 'sync') { const n = store.flushOutbox(); toast(n ? `${plural(n, 'summary', 'summaries')} marked synced (simulated)` : 'You are offline. Will sync when the network returns.'); draw(); }
    if (e.target.id === 'delface') { store.updateProfile({ face: null, calibration: null }); toast('Face data and baseline deleted'); draw(); }
    if (e.target.id === 'wipe') {
      const ok = await modal({ title: 'Delete everything?', body: '<p class="muted">Your profile, every test, all tags and camera numbers will be removed from this browser. This cannot be undone.</p>', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete everything', value: true, cls: 'danger' }] });
      if (ok) { store.reset(); location.hash = '#/welcome'; }
    }
  };
}
