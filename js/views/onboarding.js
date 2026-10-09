// First run: who you are → what you agree to (a parent's verified consent for under-18s) →
// the camera room, which learns your face. The camera is what the analysis is built on, so
// agreeing to camera-based behaviour analysis is the one required consent.
import { store } from '../store.js';
import { esc, uid, toast } from '../ui.js';
import { POLICY, DEFAULT_PREFS } from '../config.js';
import { loadDemo } from '../engine/simulate.js';
import { icon, LOGO } from '../icons.js';

const NEVER = ['Video or audio recordings', 'Your screen or other tabs', 'Emotion labels: we measure strain, not feelings', 'Uploads: face data stays on this device'];

export function render(root) {
  const st = {
    step: 0,
    name: '',
    exam: 'NEET',
    ageBand: null,
    parent: { verified: false, token: null, agreed: false, coach: false, snapshots: false, verifying: false },
    consent: { core: false, coach: true, snapshots: false, sync: false },
    profileId: null,
  };
  const u18 = () => st.ageBand === 'u18';
  const u18Blocked = () => u18() && (!POLICY.UNDER18_BEHAVIOUR_LAYER || !POLICY.UNDER18_CAMERA);
  const steps = ['About you', 'Consent', 'Camera room'];

  function draw() {
    root.innerHTML = `<div class="onb">
      <aside class="onb-side">
        <a class="brand" href="#/"><span class="brand-mark">${LOGO}</span><span class="brand-name">Exam <i>Insight</i></span></a>
        <div class="onb-pitch">
          <div class="eyebrow hl">NEET · JEE practice with a camera</div>
          <h1>Your face shows which questions you’re <span class="hl-mark">unsure of</span>.</h1>
          <p>Take a mock with your camera on. Afterwards, see every question shaded by how hard you were working on it, and the topics that strained you most.</p>
          ${preview()}
          <ul class="onb-points">
            <li><b>Measured against your own calm face.</b> The camera room learns your face first, so a naturally serious expression isn’t read as struggle.</li>
            <li><b>Four kinds of question.</b> Mastered, fragile (right but strained), blind spots (calm but wrong) and gaps. Each needs a different fix.</li>
            <li><b>Nothing leaves this device.</b> Video is read in the browser tab and thrown away. Only numbers are kept.</li>
          </ul>
        </div>
        <p class="onb-foot">Prototype · data stays in this browser</p>
      </aside>
      <section class="onb-main">${st.step === 0 ? welcome() : `<div class="onb-card">
        <ol class="onb-steps">${steps.map((s, i) => `<li class="${i + 1 < st.step ? 'done' : i + 1 === st.step ? 'cur' : ''}"><span class="bub ${i + 1 < st.step ? 'on' : i + 1 === st.step ? 'cur' : ''}">${i + 1}</span>${s}</li>`).join('')}</ol>
        ${st.step === 1 ? about() : st.step === 2 ? (u18() ? parent() : consent()) : camera()}
      </div>`}</section>
    </div>`;
  }

  const preview = () => {
    const w = [0, 1, 0, 4, 5, 2, 1, 0, 3, 5, 1, 0, 0, 2, 4, 1];
    const res = ['ok', 'ok', 'ok', 'no', 'ok', 'ok', 'ok', 'ok', 'no', 'no', 'ok', 'no', 'ok', 'ok', 'ok', 'ok'];
    return `<div class="onb-preview" aria-hidden="true">
      <div class="onb-preview-head"><span>Where you struggled</span><span>Q1 → Q16</span></div>
      <div class="onb-cells">${w.map((x, i) => `<i class="w${x} ${res[i]}">${res[i] === 'ok' ? '✓' : '✗'}</i>`).join('')}</div>
      <div class="onb-preview-note"><b>Q5</b> right, but strained for 48 s: <span class="hand">fragile</span> · <b>Q12</b> calm, but wrong: <span class="hand">blind spot</span></div>
    </div>`;
  };

  const welcome = () => `<div class="onb-card welcome">
      <div class="eyebrow">Welcome</div>
      <h2>Set up in about three minutes</h2>
      <p class="muted">Three steps: who you are, what you agree to, and the camera room, where the app learns your face. You can change any choice later in Privacy.</p>
      <button class="btn primary lg block" data-act="begin">Set up my profile</button>
      <div class="or"><span>or look around first</span></div>
      <div class="grid two">
        <button class="demo-btn" data-act="demo" data-exam="NEET"><b>NEET demo</b><span>A sample student with four past mocks and behaviour maps</span></button>
        <button class="demo-btn" data-act="demo" data-exam="JEE"><b>JEE demo</b><span>The same, computer-based</span></button>
      </div>
      <button class="demo-btn mentor mt" data-act="mentor"><b>${icon('users', { size: 16 })} I’m a mentor</b><span>Open the mentor workspace with sample batches: what to re-teach, who needs you</span></button>
      <p class="small faint mt">The demos replace any data saved in this browser.</p>
    </div>`;

  const about = () => `<h2>About you</h2>
    <div class="stack" style="gap:20px">
      <div class="field"><label for="nm">What should we call you?</label>
        <input id="nm" type="text" maxlength="40" placeholder="Your first name" value="${esc(st.name)}" autocomplete="off">
        <span class="hint">Shown on your admit card and to your mentor if you choose to share.</span></div>
      <div class="field"><span class="label">Which exam are you preparing for?</span>
        <div class="choice-grid">
          ${choice('exam', 'NEET', 'NEET UG', 'Pen-and-paper with OMR, 180 questions')}
          ${choice('exam', 'JEE', 'JEE Main', 'Computer-based, 75 questions, 3 hours')}
        </div></div>
      <div class="field"><span class="label">How old are you?</span>
        <div class="choice-grid">
          ${choice('age', 'u18', 'Under 18', 'A parent or guardian will need to consent')}
          ${choice('age', '18plus', '18 or older', 'You consent for yourself')}
        </div>
        <span class="hint">Indian law treats anyone under 18 as a child for data purposes.</span></div>
    </div>
    <div class="onb-actions"><button class="btn ghost" data-act="back">Back</button><button class="btn primary" data-act="next" ${st.ageBand ? '' : 'disabled'}>Continue</button></div>`;

  const choice = (group, value, title, sub) => {
    const checked = group === 'exam' ? st.exam === value : st.ageBand === value;
    return `<label class="choice"><input type="radio" name="${group}" value="${value}" ${checked ? 'checked' : ''}><div><strong>${title}</strong><span>${sub}</span></div></label>`;
  };

  const coreText = (who) => `${who} test answers, timings and <b>face, read by the camera during every test</b> are analysed on this device to show where ${who === 'My child’s' ? 'they' : 'I'} struggled. Only numbers are kept: strain per second, whether ${who === 'My child’s' ? 'they were' : 'I was'} reading, writing or looking away, and one small admit-card photo.`;

  const consent = () => `<h2>What you agree to</h2>
    <p class="muted">The camera is how this app works: it reads your expressions while you attempt the paper. Without it there is no behaviour map.</p>
    <label class="check-row core ${st.consent.core ? 'on' : ''}"><input type="checkbox" id="core" ${st.consent.core ? 'checked' : ''}>
      <span><b>Required.</b> I agree: my ${coreText('My').replace(/^My /, '')}</span></label>
    <div class="card flat tight mt">
      ${toggle('coach', 'Share with my mentor', 'Your mentor sees your results and behaviour maps, and can assign practice and leave notes. You can stop sharing any time.')}
      ${toggle('snapshots', 'Save a small photo when something is flagged', 'If a phone or another person is seen during a test, keep one small photo so your mentor can judge it. Off by default.')}
      ${toggle('sync', 'Back up numeric summaries', 'Queue per-test numbers for upload when you are online. (No server in this prototype: nothing is sent.)')}
    </div>
    <div class="never"><div class="eyebrow">Never captured</div><ul>${NEVER.map((n) => `<li>${n}</li>`).join('')}</ul></div>
    <div class="onb-actions"><button class="btn ghost" data-act="back">Back</button><button class="btn primary" data-act="next" ${st.consent.core ? '' : 'disabled'}>Continue</button></div>`;

  const toggle = (key, title, body) => `<div class="toggle-row">
      <div class="txt"><strong>${title}</strong><p>${body}</p></div>
      <label class="switch"><input type="checkbox" data-consent="${key}" ${st.consent[key] ? 'checked' : ''} aria-label="${esc(title)}"><span class="track"></span></label>
    </div>`;

  const parent = () => u18Blocked()
    ? `<h2>Not available for under-18s yet</h2>
      <p class="muted">Camera-based behaviour analysis for children is switched off while we wait for a legal opinion under the DPDP Act. Ask an adult to explore the sample data instead.</p>
      <div class="onb-actions"><button class="btn ghost" data-act="back">Back</button><button class="btn" data-act="demo" data-exam="${st.exam}">Open the sample data</button></div>`
    : `<h2>Parent or guardian consent</h2>
    <p class="muted">Before anything is stored about your child, a parent or guardian has to confirm they are an identifiable adult and agree. A tick-box from the student is not enough under the DPDP Rules.</p>
    <div class="verify-box ${st.parent.verified ? 'ok' : ''}">
      ${st.parent.verified
        ? `<div class="row"><span class="chip good"><span class="dot"></span>Verified</span><span class="mono small">${esc(st.parent.token)}</span></div>
           <p class="small muted mb0" style="margin-top:6px">Adult identity confirmed through a DigiLocker virtual token. No ID number is stored here.</p>`
        : `<div><strong>Verify the parent’s identity</strong><p class="small muted mb0">A virtual token from an authorised provider such as DigiLocker. Simulated in this prototype; no ID is entered.</p></div>
           <button class="btn" data-act="verify" ${st.parent.verifying ? 'disabled' : ''}>${st.parent.verifying ? 'Verifying…' : 'Verify via DigiLocker (simulated)'}</button>`}
    </div>
    <label class="check-row core ${st.parent.agreed ? 'on' : ''}"><input type="checkbox" id="pagree" ${st.parent.agreed ? 'checked' : ''} ${st.parent.verified ? '' : 'disabled'}>
      <span><b>Required.</b> As the parent or guardian, I agree: ${coreText('My child’s')}</span></label>
    <label class="check-row"><input type="checkbox" id="pcoach" ${st.parent.coach ? 'checked' : ''} ${st.parent.verified ? '' : 'disabled'}>
      <span>Share my child’s results and behaviour maps with their mentor.</span></label>
    <label class="check-row"><input type="checkbox" id="psnap" ${st.parent.snapshots ? 'checked' : ''} ${st.parent.verified ? '' : 'disabled'}>
      <span>Keep one small photo when a phone or another person is seen during a test, for the mentor to judge.</span></label>
    <div class="onb-actions"><button class="btn ghost" data-act="back">Back</button><button class="btn primary" data-act="next" ${st.parent.verified && st.parent.agreed ? '' : 'disabled'}>Continue</button></div>`;

  const camera = () => `<h2>The camera room</h2>
    <p class="muted">Before your first test the app learns your face. It takes about two minutes and you only do it once (a quick room check runs before each test).</p>
    <ol class="room-preview">
      <li><span class="bub on">1</span><div><b>Light and framing</b><span>It won’t continue until your face is clearly lit: not washed out, not dark, not back-lit.</span></div></li>
      <li><span class="bub on">2</span><div><b>Your calm face</b><span>Six seconds reading a line, relaxed. Everything is measured against this.</span></div></li>
      <li><span class="bub on">3</span><div><b>A frown and pressed lips</b><span>So your own strongest expression sets the scale.</span></div></li>
      <li><span class="bub on">4</span><div><b>Screen corners and writing</b><span>So glancing at a corner or doing rough work is never mistaken for looking away.</span></div></li>
    </ol>
    <div class="onb-actions"><button class="btn ghost" data-act="back">Back</button><div class="row"><button class="btn ghost" data-act="later">Before my first test</button><button class="btn primary lg" data-act="room">${icon('camera', { size: 16 })} Open the camera room</button></div></div>`;

  /** Create (or refresh) the profile from the current choices. Called when leaving the consent step. */
  const saveProfile = () => {
    const now = Date.now();
    st.profileId ||= uid('p');
    const existing = store.profile?.id === st.profileId ? store.profile : null;
    store.setProfile({
      id: st.profileId,
      name: st.name.trim() || 'Student',
      exam: st.exam,
      ageBand: st.ageBand,
      createdAt: existing?.createdAt || now,
      parental: u18() ? { method: 'digilocker-token (simulated)', token: st.parent.token, at: st.parent.at } : null,
      consent: u18()
        ? { behaviour: st.parent.agreed, camera: st.parent.agreed, coach: st.parent.coach, snapshots: st.parent.snapshots, sync: false, at: now, by: 'parent' }
        : { behaviour: st.consent.core, camera: st.consent.core, coach: st.consent.coach, snapshots: st.consent.snapshots, sync: st.consent.sync, at: now, by: 'self' },
      calibration: existing?.calibration || null,
      face: existing?.face || null,
      prefs: existing?.prefs || { ...DEFAULT_PREFS, bank: st.exam === 'NEET' ? 'easy' : 'easy' },
      examDate: existing?.examDate || null,
      targetScore: existing?.targetScore ?? null,
    });
  };

  root.addEventListener('input', (e) => { if (e.target.id === 'nm') st.name = e.target.value; });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'exam') { st.exam = t.value; }
    else if (t.name === 'age') { st.ageBand = t.value; draw(); }
    else if (t.id === 'core') { st.consent.core = t.checked; draw(); }
    else if (t.dataset.consent) { st.consent[t.dataset.consent] = t.checked; }
    else if (t.id === 'pagree') { st.parent.agreed = t.checked; draw(); }
    else if (t.id === 'pcoach') { st.parent.coach = t.checked; }
    else if (t.id === 'psnap') { st.parent.snapshots = t.checked; }
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'begin') { st.step = 1; draw(); root.querySelector('#nm')?.focus(); }
    else if (act === 'back') { st.step -= 1; draw(); }
    else if (act === 'next') {
      st.step += 1;
      if (st.step === 3) saveProfile();
      draw();
    } else if (act === 'verify') {
      st.parent.verifying = true; draw();
      await new Promise((r) => setTimeout(r, 900));
      st.parent = { ...st.parent, verifying: false, verified: true, token: `DL-VT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, at: Date.now() };
      draw();
    } else if (act === 'room') {
      saveProfile();
      location.hash = '#/room?calibrate=1&next=';
    } else if (act === 'later') {
      saveProfile();
      location.hash = '#/';
      toast('The camera room will open before your first test');
    } else if (act === 'demo') {
      loadDemo(b.dataset.exam);
      location.hash = '#/';
      toast('Sample student loaded: four past mocks with behaviour maps');
    } else if (act === 'mentor') {
      if (!store.profile) loadDemo('NEET');
      location.hash = '#/mentor';
    }
  });

  draw();
}
