// Settings: profile, exam date and target, appearance, test preferences, app install.
import { store } from '../store.js';
import { BANKS, DEFAULT_PREFS } from '../config.js';
import { esc, toast, fmtDate } from '../ui.js';
import { icon } from '../icons.js';
import { applyTheme } from '../theme.js';
import { pwa } from '../pwa.js';
import { cameraAllowed, faceEnrolled } from '../engine/paper.js';

export function render(root) {
  const draw = () => {
    const p = store.profile;
    const prefs = store.prefs;
    const camOk = cameraAllowed(p);
    const enrolled = faceEnrolled(p);
    const days = p.examDate ? Math.ceil((new Date(p.examDate) - Date.now()) / 86400000) : null;
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button class="${prefs[key] === v ? 'on' : ''}" data-pref="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const toggle = (key, title, body) => `<div class="toggle-row"><div class="txt"><strong>${title}</strong><p>${body}</p></div>
      <label class="switch"><input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''} aria-label="${esc(title)}"><span class="track"></span></label></div>`;
    root.innerHTML = `<div class="container narrow">
      <div class="eyebrow">Account</div><h1>Settings</h1>
      <section class="card mt">
        <h2>Profile</h2>
        <div class="form-grid">
          <div class="field"><label for="s-name">Name</label><input id="s-name" type="text" maxlength="40" value="${esc(p.name || '')}" data-profile="name"></div>
          <div class="field"><label for="s-exam">Exam</label><select id="s-exam" data-profile="exam"><option value="JEE" ${p.exam === 'JEE' ? 'selected' : ''}>JEE Main</option><option value="NEET" ${p.exam === 'NEET' ? 'selected' : ''}>NEET UG</option></select></div>
          <div class="field"><label for="s-date">Exam date</label><input id="s-date" type="date" value="${p.examDate || ''}" data-profile="examDate"><span class="hint">${days != null ? (days > 0 ? `${days} days to go` : 'That date has passed') : 'Drives the countdown and the weekly plan.'}</span></div>
          <div class="field"><label for="s-target">Target score (% of marks)</label><input id="s-target" type="number" min="1" max="100" value="${p.targetScore ?? ''}" data-profile="targetScore" placeholder="e.g. 70"></div>
        </div>
      </section>
      <section class="card mt">
        <h2>Appearance</h2>
        <div class="toggle-row"><div class="txt"><strong>Theme</strong><p>System follows your device setting.</p></div>${seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        <div class="toggle-row"><div class="txt"><strong>Motion</strong><p>Reduce turns off page transitions and the replay animation.</p></div>${seg('motion', [['system', 'System'], ['reduce', 'Reduce']])}</div>
      </section>
      <section class="card mt">
        <h2>Tests</h2>
        <div class="toggle-row"><div class="txt"><strong>Question bank</strong><p>${esc(BANKS[prefs.bank].blurb)}</p></div>${seg('bank', [['easy', BANKS.easy.label], ['standard', BANKS.standard.label]])}</div>
        ${toggle('paceHint', 'Pace hint during mocks', 'A small “ahead / behind” pill in the test bar. The real exam has no such hint, so it is off by default.')}
        ${toggle('fullscreen', 'Ask for full screen', 'Fewer distractions, like the exam hall. You can change it on each test’s start page too.')}
      </section>
      <section class="card mt">
        <h2>Camera</h2>
        <div class="toggle-row"><div class="txt"><strong>Camera room</strong><p>${camOk
          ? p.calibration?.v === 2
            ? `Calibrated ${fmtDate(p.calibration.at)}${p.calibration.quality != null ? ` · light ${p.calibration.quality}/100` : ''}. Before each test a short room check re-reads the light and sets that day’s calm baseline. Recalibrate if you change rooms, camera or seating.`
            : 'Not calibrated yet. The camera room learns your face before your first test, in about two minutes.'
          : p.ageBand === 'u18' ? 'Off: camera-based analysis needs a parent’s consent, given in Privacy.' : 'Off. Tests need camera-based analysis; turn it on in Privacy.'}</p></div>
          ${camOk ? `<div class="row">${enrolled && p.face.thumb ? `<img class="face-thumb sm" src="${p.face.thumb}" alt="Your admit-card photo">` : ''}<a class="btn sm ${p.calibration?.v === 2 ? '' : 'primary'}" href="#/room?calibrate=1&next=settings">${icon('camera', { size: 14 })} ${p.calibration?.v === 2 ? 'Recalibrate' : 'Calibrate'}</a></div>` : `<a class="btn sm" href="#/privacy">${p.ageBand === 'u18' ? 'Privacy' : 'Turn on'}</a>`}</div>
      </section>
      <section class="card mt">
        <h2>App</h2>
        <div class="toggle-row"><div class="txt"><strong>Install Exam Insight</strong><p>${pwa.installed ? 'Installed on this device.' : pwa.canInstall ? 'Opens in its own window and works offline.' : 'Your browser will offer installation once the app has been visited a couple of times, or use its “Install app” menu item.'}</p></div>
          ${pwa.canInstall ? `<button class="btn" id="install">${icon('install', { size: 15 })} Install</button>` : ''}</div>
        <div class="toggle-row"><div class="txt"><strong>Offline</strong><p>${pwa.swReady ? 'The app shell is cached. Tests, reports and drills work without a connection; sync waits for one.' : 'Service worker not active yet (needs HTTPS or localhost).'}</p></div><span class="chip ${navigator.onLine ? 'good' : 'warn'}">${navigator.onLine ? 'Online' : 'Offline'}</span></div>
        <div class="toggle-row"><div class="txt"><strong>Data &amp; privacy</strong><p>Consent choices, export and delete live on the Privacy page.</p></div><a class="btn sm" href="#/privacy">Open Privacy</a></div>
      </section>
      <p class="small faint mt">Profile created ${fmtDate(p.createdAt, { year: true })}${p.demo ? ' · demo profile' : ''}.</p>
    </div>`;
  };
  draw();

  root.onclick = async (e) => {
    const b = e.target.closest('button[data-pref]');
    if (b) {
      store.setPref(b.dataset.pref, b.dataset.v);
      if (b.dataset.pref === 'theme' || b.dataset.pref === 'motion') applyTheme();
      draw();
      return;
    }
    if (e.target.closest('#install')) { const ok = await pwa.install(); toast(ok ? 'Installed' : 'Install dismissed'); draw(); }
  };
  root.onchange = (e) => {
    const t = e.target;
    if (t.type === 'checkbox' && t.dataset.pref) { store.setPref(t.dataset.pref, t.checked); toast('Saved'); return; }
    if (t.dataset.profile) {
      let v = t.value;
      if (t.dataset.profile === 'targetScore') v = v === '' ? null : Math.max(1, Math.min(100, Number(v)));
      if (t.dataset.profile === 'name') v = v.trim() || 'Student';
      if (t.dataset.profile === 'examDate') v = v || null;
      store.updateProfile({ [t.dataset.profile]: v });
      toast('Saved');
      if (t.dataset.profile !== 'name') draw();
    }
  };
}
