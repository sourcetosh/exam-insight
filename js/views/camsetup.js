// Shared camera-check widget: live preview with an oval guide, one-line guidance,
// a steadiness ring and the proctoring checklist. Used by enrolment, the pre-test
// check and Settings. The DOM is updated in place on every frame (no re-render).
import { ProctorSession } from '../face/proctor.js';
import { PROCTOR } from '../config.js';
import { esc } from '../ui.js';
import { icon } from '../icons.js';

const ICON = { ok: icon('check', { size: 14 }), bad: icon('x', { size: 14 }), wait: '<i class="spin"></i>', skip: '<i class="dash"></i>', info: icon('info', { size: 14 }) };
const RING = 2 * Math.PI * 16;

export function mountCamCheck(host, { mode = 'precheck', enrolled = null, fullscreen = false, wantObjects = true, wantIdentity = true, enrolHref = null, listHost = null, onTick = null } = {}) {
  const proctor = new ProctorSession({ mode, enrolled, wantObjects, wantIdentity, fullscreen });
  host.innerHTML = `<div class="cc ${mode === 'enrol' ? 'is-enrol' : ''}">
    <div class="cc-cam">
      <video class="cc-video" muted playsinline aria-label="Camera preview"></video>
      <div class="cc-oval" aria-hidden="true"></div>
      <svg class="cc-ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="16"/><circle class="fg" cx="18" cy="18" r="16" style="stroke-dasharray:${RING.toFixed(2)};stroke-dashoffset:${RING.toFixed(2)}"/></svg>
      <div class="cc-guide"><span class="dot"></span><span class="cc-guide-txt">Starting the camera…</span></div>
      <div class="cc-off" hidden><div>${icon('camera', { size: 28 })}<p class="cc-off-txt"></p></div></div>
    </div>
    ${listHost ? '' : '<ul class="cc-list" aria-live="polite"></ul>'}
  </div>`;
  if (listHost) listHost.innerHTML = '<ul class="cc-list" aria-live="polite"></ul>';
  const video = host.querySelector('.cc-video');
  const oval = host.querySelector('.cc-oval');
  const ring = host.querySelector('.cc-ring');
  const ringFg = ring.querySelector('.fg');
  const guide = host.querySelector('.cc-guide');
  const guideTxt = host.querySelector('.cc-guide-txt');
  const off = host.querySelector('.cc-off');
  const offTxt = host.querySelector('.cc-off-txt');
  const list = (listHost || host).querySelector('.cc-list');
  let last = null;

  const wantMicButton = (c) => c.id === 'mic' && !['denied', 'error', 'running', 'loading'].includes(proctor.micState);
  const row = (c) => {
    let action = '';
    if (wantMicButton(c)) action = '<button class="btn sm cc-act" data-cc="mic">Allow</button>';
    if (c.id === 'identity' && !enrolled?.length && enrolHref) action = `<a class="btn sm cc-act" href="${enrolHref}">Set up</a>`;
    return `<li class="${c.state}" data-check="${c.id}"><span class="cc-ic">${ICON[c.state] || ''}</span><div class="cc-txt"><b>${esc(c.label)}</b><span class="cc-d">${esc(c.detail)}</span></div>${action}</li>`;
  };

  const paint = (ev) => {
    last = ev;
    const sameShape = list.children.length === ev.checks.length && [...list.children].every((li, i) => li.dataset.check === ev.checks[i].id);
    if (!sameShape) {
      list.innerHTML = ev.checks.map(row).join('');
    } else {
      ev.checks.forEach((c, i) => {
        const li = list.children[i];
        if (li.className !== c.state) { li.className = c.state; li.querySelector('.cc-ic').innerHTML = ICON[c.state] || ''; }
        const d = li.querySelector('.cc-d');
        if (d.textContent !== c.detail) d.textContent = c.detail;
        if (c.id === 'mic') {
          const act = li.querySelector('.cc-act');
          const want = wantMicButton(c);
          if (want && !act) li.insertAdjacentHTML('beforeend', '<button class="btn sm cc-act" data-cc="mic">Allow</button>');
          if (!want && act) act.remove();
        }
      });
    }
    const by = Object.fromEntries(ev.checks.map((c) => [c.id, c.state]));
    const running = ev.cam.state === 'running';
    const faceOk = by.face === 'ok' && by.align === 'ok' && by.pose === 'ok' && by.light === 'ok';
    const faceBad = ['face', 'align', 'pose', 'light'].some((k) => by[k] === 'bad');
    oval.className = `cc-oval ${!running ? '' : faceOk ? 'ok' : faceBad ? 'bad' : ''}`;
    guide.className = `cc-guide ${ev.ready ? 'ok' : ev.cam.state === 'error' ? 'bad' : ''}`;
    guideTxt.textContent = ev.cam.state === 'error' ? 'Camera unavailable' : ev.guidance || (running ? 'Looking for your face…' : 'Starting the camera…');
    const frac = Math.min(1, ev.steadyMs / PROCTOR.steadyMs);
    ringFg.style.strokeDashoffset = (RING * (1 - frac)).toFixed(2);
    ring.classList.toggle('on', ev.ready);
    const camOff = ev.cam.state === 'error' || ev.cam.state === 'off';
    off.hidden = !camOff;
    if (camOff) offTxt.textContent = ev.checks.find((c) => c.id === 'camera')?.detail || '';
    onTick?.(ev);
  };

  proctor.subscribe(paint);
  (listHost || host).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cc="mic"]');
    if (!b) return;
    b.disabled = true;
    b.textContent = 'Starting…';
    await proctor.allowMic();
  });

  proctor.start().then((ok) => { if (ok) proctor.attach(video); }).catch(() => {});

  return {
    proctor,
    get last() { return last; },
    attach() { proctor.attach(video); },
    destroy({ camera = true } = {}) { proctor.stop({ camera }); },
  };
}
