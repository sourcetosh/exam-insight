// How it works: signals, the friction index, topic groups and pattern rules, in plain view.
import { store } from '../store.js';
import { WEIGHTS, THRESHOLDS as T, DIFFICULTY_MULT, FACE, TAGS, EXPRESSION } from '../config.js';
import { GROUPS, GROUP_ORDER } from '../engine/topics.js';
import { analyze } from '../engine/report.js';
import { mean, signed, plural } from '../ui.js';

const SIGNALS = [
  ['Time per question vs expected time', 'Test UI event log', 'High', 'Time sinks, topic difficulty, pacing'],
  ['Visits, revisits, skips, mark-for-review', 'Event log', 'High', 'Hesitation, panic-skipping, avoidance'],
  ['Answer changes, incl. right-to-wrong flips', 'Event log', 'High', 'Doubt, second-guessing'],
  ['Idle gaps, tab blur, fullscreen exit', 'Browser events', 'High', 'Freezing, lost focus'],
  ['Correctness and marks, incl. negative marking', 'Scoring', 'High', 'Accuracy, guessing behaviour'],
  ['Self-report tag: Sure / Guessed / Panicked / Blank', 'Post-test review', 'High, but subjective', 'Ground truth to calibrate every other signal'],
  ['Strain: brow furrow, lip press, squint and more, vs your calm face', 'Face blendshapes, on-device, calibrated', 'High (the core signal)', 'Struggle per question and topic, onset, spillover, stamina'],
  ['Reading, writing or looking away', 'Head pose and gaze vs your screen map and writing posture', 'High', 'Rough-work load, look-aways, attention gaps'],
  ['Picture quality per frame', 'Inner-face brightness, contrast, sharpness', 'Gate', 'Frames that fail are left out, never counted against you'],
];

const RULES = [
  ['Time sink', `One question takes over ${T.timeSink}× its expected time`, '“Question 41 took 6 minutes; skipping and returning is cheaper”'],
  ['Panic skipping', `${T.panicRun}+ questions viewed under ${T.panicSkipSec}s in a row right after a hard one or a Panicked tag`, 'The run of skipped questions and what they were worth'],
  ['Freeze', `Idle over ${T.freezeIdleSec}s with no answer, or the tab loses focus`, 'Where it happened and what came next'],
  ['Second-guessing', 'An answer changed from right to wrong', 'Number of flips and marks lost'],
  ['Late-test collapse', `Accuracy or pace in the last ${T.lateFrac * 100}% clearly below the first ${100 - T.lateFrac * 100}%`, 'Fatigue curve across the paper'],
  ['Subject-switch cost', `First three questions after a subject change take over ${T.switchCost}× normal time`, 'Warm-up cost per switch'],
  ['Opening jitters', 'Friction in the first five questions well above the student’s median', 'How quickly they settled'],
];

const w = (x) => x.toFixed(2);

export function render(root) {
  const done = store.profile ? store.sessions({ status: 'done' }).filter((s) => s.analytics === 'full') : [];
  const rows = done.flatMap((s) => analyze(s).rows).filter((r) => r.tag && r.F != null);
  const tagMeans = TAGS.map((t) => { const v = rows.filter((r) => r.tag === t.id).map((r) => r.F); return { ...t, n: v.length, m: v.length ? mean(v) : null }; });
  const maxAbs = Math.max(0.5, ...tagMeans.filter((x) => x.m != null).map((x) => Math.abs(x.m)));

  root.innerHTML = `<div class="container narrow-wide methods">
    <div class="eyebrow">Method</div>
    <h1>How Exam Insight works</h1>
    <p class="lead">NEET and JEE-style mocks that read your face while you attempt the paper. The camera measures visible effort, second by second, against your own calm face; afterwards every question and topic is placed by how much it strained you and how it went. Every insight is tied to a topic and a question, and nothing is ever labelled as a feeling.</p>

    <section class="card mt">
      <h2>How the behaviour map is made</h2>
      <ol class="rules">
        <li><b>The camera room refuses a bad picture.</b> A 96×96 crop of your inner face is checked on every frame: washed out (clipped whites, or bright with no detail), too dark (dim with crushed blacks), back-lit, flat, one-sided, blurry, badly framed. The paper waits until it passes.</li>
        <li><b>It learns your face.</b> Six seconds of your calm face, then your own frown and pressed lips set the scale; five screen dots and a look at your rough sheet teach it where the screen is and what writing looks like.</li>
        <li><b>During the paper, every second gets a state</b> (reading, writing, looking away, face not visible, picture too poor) and, while reading, a strain level: brow furrow, lip press, eye squint and similar actions, each scaled between your calm face and your own range. The strongest single channel leads, because people show effort differently.</li>
        <li><b>Per question</b>: seconds strained, when the strain began, its peak, the strain just before you answered, and which actions carried it, combined into a struggle index from 0 to 100 (needs ${EXPRESSION.minReadSec}+ readable seconds).</li>
        <li><b>Against the outcome</b>: calm and correct = mastered; strained but correct = fragile; calm but wrong = blind spot; strained and wrong = gap; strained then skipped = avoided.</li>
      </ol>
    </section>

    <section class="card mt">
      <h2>Signals</h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>Signal</th><th>Source</th><th>Trust</th><th>Used for</th></tr></thead>
      <tbody>${SIGNALS.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td><span class="chip ${r[2] === 'High' ? 'good' : r[2] === 'Low' ? 'warn' : ''}">${r[2]}</span></td><td>${r[3]}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted mt mb0"><b>Never captured:</b> video, images, audio, screen contents, other people in the room, or any cheating flag.</p>
    </section>

    <section class="card mt">
      <h2>Friction index</h2>
      <p class="muted">One number per question: how much it cost you compared with your own usual behaviour.</p>
      <div class="formula">F<sub>q</sub> = ${w(WEIGHTS.time)} z(t<sub>q</sub> / <span class="hat">t</span><sub>q</sub>) + ${w(WEIGHTS.revisits)} z(r<sub>q</sub>) + ${w(WEIGHTS.changes)} z(c<sub>q</sub>) + ${w(WEIGHTS.idle)} z(i<sub>q</sub>) + ${w(WEIGHTS.face)} z(f<sub>q</sub>)</div>
      <div class="grid two mt">
        <ul class="ticks small">
          <li><b>t</b> time on the question, <b class="hat">t</b> expected time</li>
          <li><b>r</b> revisits, <b>c</b> answer changes</li>
          <li><b>i</b> longest idle gap, <b>f</b> facial tension marker</li>
        </ul>
        <ul class="ticks small">
          <li><b>z</b> is a z-score against your own history; the pilot cohort is used for your first ${T.ownHistoryAfter} tests.</li>
          <li>The face term never exceeds ${WEIGHTS.face}. Without a camera, its weight is spread proportionally over the other four.</li>
          <li>Weights are starting guesses, tuned against self-report tags in the pilot.</li>
        </ul>
      </div>
      <h3 class="mt">Expected time</h3>
      <p class="small muted mb0">The exam’s total time ÷ question count, times a teacher-set difficulty multiplier (easy ${DIFFICULTY_MULT[1]}×, medium ${DIFFICULTY_MULT[2]}×, hard ${DIFFICULTY_MULT[3]}×). Once a question has about ${T.empiricalAttempts} attempts, its median time among correct answers replaces the estimate.</p>
    </section>

    ${rows.length ? `<section class="card mt">
      <h2>Is friction tracking your own sense of it?</h2>
      <p class="muted small">Mean friction for questions you tagged in each way, across ${plural(done.length, 'test')}. If the index works, Guessed and Panicked should sit above Sure.</p>
      <div class="tagbars">${tagMeans.map((t) => `<div class="tagbar"><span class="tb-l">${t.label}</span>
        <span class="tb-track2">${t.m == null ? '' : `<span class="tb-bar ${t.m >= 0 ? 'pos' : 'neg'}" style="${t.m >= 0 ? `left:50%;width:${(t.m / maxAbs) * 50}%` : `right:50%;width:${(-t.m / maxAbs) * 50}%`}"></span>`}<span class="tb-mid"></span></span>
        <span class="tb-v num">${t.m == null ? '—' : signed(t.m)}</span><span class="small faint">${t.n} Q</span></div>`).join('')}</div>
    </section>` : ''}

    <section class="card mt">
      <h2>Topic groups</h2>
      <p class="muted small">Every question is tagged subject, chapter and topic. Accuracy and time place each topic in one of four groups. “Over expected” means above ${T.overExpected}× expected time; “low accuracy” means below ${T.lowAccuracy * 100}%. A topic is flagged only after ${T.minTopicQuestions} questions, and stays an early signal until the pattern repeats across ${T.confirmTests} tests.</p>
      <div class="grid two">${GROUP_ORDER.map((g) => `<div class="group-tile"><span class="group-chip ${GROUPS[g].cls}"><i></i>${GROUPS[g].label}</span><p class="small muted">${GROUPS[g].pattern}</p><p class="small mb0"><b>Report says:</b> ${GROUPS[g].action}</p></div>`).join('')}</div>
    </section>

    <section class="card mt">
      <h2>Behaviour patterns</h2>
      <p class="muted small">Transparent rules on the event log. Machine learning waits until the pilot has enough self-report tags to train on.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Pattern</th><th>Starting rule</th><th>You see</th></tr></thead>
      <tbody>${RULES.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td class="muted">${r[2]}</td></tr>`).join('')}</tbody></table></div>
    </section>

    <section class="card mt">
      <h2>What the camera claims, and what it doesn’t</h2>
      <p class="muted">A review of more than 1,000 studies commissioned by the Association for Psychological Science found that facial movements do not map reliably or specifically onto emotions: the same movement means different things in different people. Visible effort is a different, narrower thing: brow lowering, lip pressing and lid tightening rise with mental effort and difficulty. So the app:</p>
      <ul class="ticks">
        <li>measures strain, never a feeling: it never labels a face as fear, anxiety or panic;</li>
        <li>scales every facial action between <i>your</i> calm face and <i>your</i> own frown, so a naturally serious face isn’t read as struggle;</li>
        <li>sets it against what happened (right, wrong, skipped, time, changes) to give the four kinds of question;</li>
        <li>refuses a picture it can’t read in the camera room, and during the test leaves out any frame that fails the quality check, showing it as a gap instead of guessing;</li>
        <li>lets your own tag after the test stand next to the inference.</li>
      </ul>
    </section>
  </div>`;
}
