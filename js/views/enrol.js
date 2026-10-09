// Face enrolment: fit the face in the oval, hold still, and the app captures a few face
// signatures, a small mirrored thumbnail and a quick tension baseline. All of it stays
// on this device. Reached from onboarding, Settings, the pre-test page or Home.
import { store } from '../store.js';
import { mountCamCheck } from './camsetup.js';
import { PROCTOR } from '../config.js';
import { esc, toast } from '../ui.js';
import { icon } from '../icons.js';

export function render(root, _params, query) {
  const p = store.profile;
  const q = new URLSearchParams(query || '');
  const nextRaw = (q.get('next') || '').replace(/^#?\/?/, '');
  const next = `#/${nextRaw}`;
  const again = !!p.face;
  const st = { phase: 'live', face: null, capturing: false };

  root.innerHTML = `<div class="pc-page"><div class="container narrow-wide">
    <a class="back-link" href="${next}">${icon('back', { size: 14 })} Back</a>
    <div class="pc">
      <div class="pc-side"><div id="cam"></div><div id="checks" class="mt"></div></div>
      <div class="pc-main" id="main"></div>
    </div>
  </div></div>`;

  const main = root.querySelector('#main');
  const draw = () => {
    if (st.phase === 'live') {
      main.innerHTML = `<div class="eyebrow">Camera setup · about a minute</div>
        <h1>${again ? 'Save your face again' : 'Save your face'}</h1>
        <p class="muted">Before every test the app checks that it is you at the camera, that you are alone, and that no phone is in view. To do that it keeps a face signature (128 numbers) and a small photo, on this device only.</p>
        <ul class="ticks small">
          <li>Sit about an arm’s length away, with light on your face rather than behind you.</li>
          <li>Take off a cap or sunglasses. Ordinary glasses are fine.</li>
          <li>Fit your face in the oval and hold still. The ring fills, then the capture happens by itself.</li>
        </ul>
        <div class="notice calm mt">${icon('shield')}<div>Nothing is uploaded. You can delete this from Privacy at any time, and tests still run without it (unproctored).</div></div>
        <div class="row mt"><a class="btn ghost" href="${next}">${again ? 'Keep the old one' : 'Skip for now'}</a></div>`;
    } else if (st.phase === 'capturing') {
      main.innerHTML = `<div class="eyebrow">Camera setup</div><h1>Hold still…</h1><p class="muted">Taking a few readings.</p>`;
    } else {
      const f = st.face;
      main.innerHTML = `<div class="eyebrow">Camera setup</div>
        <h1>Got it</h1>
        <div class="enrol-result">
          ${f.thumb ? `<img class="enrol-thumb" src="${f.thumb}" alt="Your reference photo">` : ''}
          <div class="summary-list" style="margin:0;flex:1">
            <div><span>Face signature</span><b>${f.descriptors.length ? `${f.descriptors.length} readings` : 'Not captured'}</b></div>
            <div><span>Reference photo</span><b>${f.thumb ? 'Saved on this device' : 'None'}</b></div>
            <div><span>Tension baseline</span><b>${f.baseline ? 'Quick baseline set' : 'Not enough frames'}</b></div>
          </div>
        </div>
        ${f.descriptors.length ? '' : `<div class="notice warn mt">${icon('alert')}<div>The identity model could not be loaded (offline?), so the “it’s you” check will be skipped until you enrol again with a connection.</div></div>`}
        <div class="row mt"><button class="btn primary lg" id="use">${icon('check', { size: 16 })} Looks good</button><button class="btn" id="retake">Retake</button></div>`;
    }
  };
  draw();

  const cc = mountCamCheck(root.querySelector('#cam'), {
    mode: 'enrol', listHost: root.querySelector('#checks'),
    onTick: async (ev) => {
      if (st.phase !== 'live' || st.capturing) return;
      if (!(ev.ready && ev.steadyMs >= PROCTOR.steadyMs)) return;
      st.capturing = true;
      st.phase = 'capturing';
      draw();
      try {
        st.face = await cc.proctor.enrol();
        st.phase = 'done';
      } catch (e) {
        console.error(e);
        toast('Capture failed. Try again.');
        st.phase = 'live';
      }
      st.capturing = false;
      draw();
    },
  });

  root.onclick = (e) => {
    if (e.target.closest('#retake')) { st.face = null; st.phase = 'live'; cc.proctor.readySince = null; draw(); return; }
    if (e.target.closest('#use')) {
      const f = st.face;
      const patch = { face: { at: f.at, descriptors: f.descriptors, thumb: f.thumb, model: f.model } };
      if (f.baseline && (!p.calibration || p.calibration.kind === 'quick')) patch.calibration = f.baseline;
      store.updateProfile(patch);
      toast('Face saved on this device');
      location.hash = next;
    }
  };

  return () => cc.destroy();
}
