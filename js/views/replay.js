// Minute-by-minute replay: subject lanes show which question was open at every moment,
// with answer saves, changes, idle gaps and tab switches marked; a pace curve below
// compares answers over time with the even pace the clock allowed.
import { esc, fmtClock, fmtDur, plural } from '../ui.js';
import { icon } from '../icons.js';
import { PROCTOR } from '../config.js';

const IDLE = '<div class="rp-idle-msg">Hover or tap anywhere on the strip to see that moment. Click a block to open the question below.</div>';
const SUBJ_CLASS = { Physics: 's-phy', Chemistry: 's-che', Mathematics: 's-mat', Botany: 's-bot', Zoology: 's-zoo' };
export const subjClass = (s) => SUBJ_CLASS[s] || 's-oth';

function tickStep(totalMin) {
  for (const s of [1, 2, 5, 10, 15, 20, 30, 60]) if (totalMin / s <= 12) return s;
  return 60;
}

export function replayHTML(tl, { rows }) {
  const span = Math.max(tl.allowed, tl.elapsed);
  const X = (t) => (t / span) * 100;
  const byN = new Map(rows.map((r) => [r.n, r]));
  const lanes = tl.lanes.map((subject) => {
    const segs = tl.segments.filter((x) => x.subject === subject).map((x) => {
      const w = X(x.end) - X(x.start);
      const rel = (t) => ((t - x.start) / Math.max(1, x.dur)) * 100;
      const res = x.result === true ? 'ok' : x.result === false ? 'no' : 'skip';
      return `<div class="rp-seg ${subjClass(subject)} ${x.visit > 1 ? 'revisit' : ''}" style="left:${X(x.start).toFixed(3)}%;width:${Math.max(w, 0.15).toFixed(3)}%" data-n="${x.n}" data-start="${x.start}" data-end="${x.end}" role="button" tabindex="0" aria-label="Question ${x.n}, visit ${x.visit}, ${fmtDur(x.dur / 1000)}">
        ${x.idle.map((i) => `<i class="rp-idle" style="left:${rel(i.start).toFixed(2)}%;width:${(rel(i.end) - rel(i.start)).toFixed(2)}%"></i>`).join('')}
        ${x.blur.map((i) => `<i class="rp-blur" style="left:${rel(i.start).toFixed(2)}%;width:${Math.max(0.8, rel(i.end) - rel(i.start)).toFixed(2)}%"></i>`).join('')}
        ${x.marks.map((m) => `<i class="rp-mk mk-${m.type} ${m.type === 'save' ? (m.correct ? 'ok' : 'no') : ''}" style="left:${rel(m.t).toFixed(2)}%"></i>`).join('')}
        <span class="rp-n">${x.n}</span><span class="rp-res ${res}"></span>
      </div>`;
    }).join('');
    return `<div class="rp-lane">${segs}</div>`;
  }).join('');

  // Pace curve: answered count (step) vs the even pace the clock allowed.
  const W = 1000, H = 100;
  const px = (t) => (t / span) * W;
  const py = (a) => H - (a / Math.max(1, tl.n)) * H;
  let d = `M0,${H}`;
  let last = 0;
  for (const p of tl.pace) { d += ` L${px(p.t).toFixed(1)},${py(last).toFixed(1)} L${px(p.t).toFixed(1)},${py(p.answered).toFixed(1)}`; last = p.answered; }
  const fill = `${d} L${px(tl.elapsed).toFixed(1)},${H} Z`;
  const idealEnd = Math.min(span, tl.allowed);
  const step = tickStep(span / 60000);
  const ticks = [];
  for (let m = 0; m * 60000 <= span; m += step) ticks.push(m);
  const unused = tl.elapsed < tl.allowed ? `<div class="rp-unused" style="left:${X(tl.elapsed).toFixed(2)}%"></div>` : '';

  return `<div class="rp" data-span="${span}" data-elapsed="${tl.elapsed}" data-n="${tl.n}">
    <div class="rp-tools">
      <button class="btn sm" data-rp="play">${icon('play', { size: 14 })} Play 20-second replay</button>
      <div class="rp-legend">
        ${tl.lanes.map((s) => `<span><i class="sw ${subjClass(s)}"></i>${esc(s)}</span>`).join('')}
        <span class="sep"></span>
        <span><i class="lg mk-save ok"></i>Saved right</span><span><i class="lg mk-save no"></i>Saved wrong</span><span><i class="lg mk-change"></i>Changed</span><span><i class="lg mk-flip"></i>Right→wrong</span>
        <span><i class="lg idle"></i>No input</span><span><i class="lg blur"></i>Tab away</span><span><i class="lg revisit"></i>Revisit</span>${tl.segments.some((x) => x.marks.some((m) => m.type === 'proctor')) ? '<span><i class="lg mk-proctor"></i>Proctor flag</span>' : ''}
      </div>
    </div>
    <div class="rp-body">
      <div class="rp-labels">${tl.lanes.map((s) => `<div class="rp-lab">${esc(s)}</div>`).join('')}<div class="rp-lab pace">Answered</div><div class="rp-lab axis"></div></div>
      <div class="rp-track" data-rp="track">
        <div class="rp-lanes">${lanes}</div>
        <div class="rp-pace"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="${H}" x2="${px(idealEnd).toFixed(1)}" y2="0" class="rp-ideal"/>
          <path d="${fill}" class="rp-fill"/><path d="${d}" class="rp-line"/>
        </svg><span class="rp-pace-end" style="left:${X(tl.elapsed).toFixed(2)}%">${tl.finalAnswered}/${tl.n}</span></div>
        <div class="rp-axis">${ticks.map((m) => `<span style="left:${X(m * 60000).toFixed(2)}%">${m}m</span>`).join('')}</div>
        ${unused}
        <div class="rp-cursor" hidden></div>
        <div class="rp-playhead" hidden></div>
      </div>
    </div>
    <div class="rp-card">${IDLE}</div>
  </div>`;
}

export function mountReplay(root, tl, { rows, onSelect } = {}) {
  const el = root.querySelector('.rp');
  if (!el) return () => {};
  const track = el.querySelector('[data-rp=track]');
  const card = el.querySelector('.rp-card');
  const cursor = el.querySelector('.rp-cursor');
  const playhead = el.querySelector('.rp-playhead');
  const span = Number(el.dataset.span);
  const byN = new Map(rows.map((r) => [r.n, r]));
  let raf = null, playing = false, t0 = 0;

  const atTime = (t) => {
    const seg = tl.segments.find((x) => t >= x.start && t <= x.end) || [...tl.segments].reverse().find((x) => x.start <= t) || null;
    let answered = 0;
    for (const p of tl.pace) { if (p.t <= t) answered = p.answered; else break; }
    const ideal = Math.min(tl.n, (t / tl.allowed) * tl.n);
    return { seg, answered, ideal };
  };
  const showAt = (t, xPx) => {
    t = Math.max(0, Math.min(span, t));
    const { seg, answered, ideal } = atTime(t);
    const r = seg ? byN.get(seg.n) : null;
    const lines = [];
    if (seg && t <= seg.end && t >= seg.start) {
      const into = (t - seg.start) / 1000;
      lines.push(`<b>Q${seg.n}</b> · ${esc(seg.topic)}`);
      lines.push(`Visit ${seg.visit}${r ? ` of ${r.visits}` : ''} · ${fmtDur(into)} into a ${fmtDur(seg.dur / 1000)} stop`);
      const ev = seg.marks.filter((m) => m.t <= t).slice(-3).map((m) => (m.type === 'proctor'
        ? `<span class="warn-t">${PROCTOR.flags[m.code]?.label || 'Proctoring flag'}${m.dur ? ` (${fmtDur(m.dur / 1000)})` : ''}</span>`
        : ({
          save: `Saved ${m.correct ? 'the right answer' : 'a wrong answer'}`, change: 'Changed answer', flip: 'Changed a right answer to wrong', clear: 'Cleared answer', mark: 'Marked for review', unmark: 'Unmarked', fs: 'Left full screen',
        })[m.type]));
      if (ev.length) lines.push(ev.join(' · '));
      if (seg.idle.some((i) => t >= i.start && t <= i.end)) lines.push('<span class="warn-t">No input at this moment</span>');
      if (seg.blur.some((i) => t >= i.start && t <= i.end)) lines.push('<span class="warn-t">Tab not focused</span>');
    } else if (t > tl.elapsed) {
      lines.push('<b>Test over</b> · unused time');
    } else {
      lines.push('<b>Between questions</b>');
    }
    const diff = answered - ideal;
    lines.push(`<span class="muted">Answered ${answered} of ${tl.n} · ${Math.abs(diff) < 0.5 ? 'on even pace' : diff > 0 ? `${Math.round(diff)} ahead of even pace` : `${Math.round(-diff)} behind even pace`}</span>`);
    card.innerHTML = `<div class="rp-time mono">${fmtClock(t / 1000)}</div><div class="rp-lines">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
    const rect = track.getBoundingClientRect();
    const x = xPx ?? (t / span) * rect.width;
    cursor.hidden = false;
    cursor.style.left = `${(x / rect.width) * 100}%`;
  };
  const hide = () => { if (playing) return; card.innerHTML = IDLE; cursor.hidden = true; };

  const onMove = (e) => {
    if (playing) return;
    const rect = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    showAt((x / rect.width) * span, x);
  };
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerdown', onMove);
  track.addEventListener('pointerleave', hide);
  el.addEventListener('click', (e) => {
    const seg = e.target.closest('.rp-seg');
    if (seg && onSelect) { onSelect(Number(seg.dataset.n)); return; }
    const b = e.target.closest('[data-rp=play]');
    if (b) togglePlay(b);
  });
  el.addEventListener('keydown', (e) => {
    const seg = e.target.closest('.rp-seg');
    if (seg && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect?.(Number(seg.dataset.n)); }
  });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';
  const DUR = 20000;
  function togglePlay(btn) {
    if (playing) { stop(btn); return; }
    if (reduced) { showAt(tl.elapsed); return; }
    playing = true;
    btn.innerHTML = `${icon('pause', { size: 14 })} Pause`;
    playhead.hidden = false;
    t0 = performance.now();
    const frame = (now) => {
      const f = Math.min(1, (now - t0) / DUR);
      const t = f * tl.elapsed;
      playhead.style.left = `${(t / span) * 100}%`;
      showAt(t);
      if (f < 1 && playing) raf = requestAnimationFrame(frame);
      else stop(btn, true);
    };
    raf = requestAnimationFrame(frame);
  }
  function stop(btn, finished = false) {
    playing = false;
    cancelAnimationFrame(raf);
    btn.innerHTML = `${icon(finished ? 'replay' : 'play', { size: 14 })} ${finished ? 'Replay again' : 'Play 20-second replay'}`;
    if (finished) setTimeout(() => { if (!playing) { playhead.hidden = true; } }, 1500);
    else { playhead.hidden = true; hide(); }
  }
  return () => { playing = false; cancelAnimationFrame(raf); };
}
