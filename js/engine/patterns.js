// Behaviour patterns: transparent rules on the event log. ML waits until the pilot
// has enough self-report tags to train on. Wording describes what happened, never feelings.
// Every rule reports its evidence whether or not it fired, so the report is never silent.
import { THRESHOLDS as T } from '../config.js';
import { mean, median, sum, fmtDur, plural, fix } from '../ui.js';

export const RULES = [
  { id: 'timeSink', name: 'Time sink', rule: `One question takes over ${T.timeSink}× its expected time` },
  { id: 'panicSkip', name: 'Panic skipping', rule: `${T.panicRun}+ questions viewed under ${T.panicSkipSec}s in a row right after a long stop or a Panicked tag` },
  { id: 'freeze', name: 'Freeze', rule: `Idle over ${T.freezeIdleSec}s with no answer, or the tab loses focus` },
  { id: 'secondGuess', name: 'Second-guessing', rule: 'An answer changed from right to wrong' },
  { id: 'lateCollapse', name: 'Late-test collapse', rule: `Accuracy or pace in the last ${T.lateFrac * 100}% clearly below the first ${100 - T.lateFrac * 100}%` },
  { id: 'switchCost', name: 'Subject-switch cost', rule: `First questions after a subject change take over ${T.switchCost}× your normal time` },
  { id: 'jitters', name: 'Opening jitters', rule: 'Friction in the first five questions well above your median for the test' },
];

export function analyzePatterns(s, rows, visits) {
  const byId = new Map(rows.map((r) => [r.qid, r]));
  const vis = visits
    .map((v) => ({ ...v, row: byId.get(v.q), sec: v.dur / 1000, saved: v.events.some((e) => e.type === 'save') }))
    .filter((v) => v.row);
  const found = [];
  const checks = [];
  const add = (p) => found.push(p);
  const check = (id, ok, evidence, qs = []) => checks.push({ ...RULES.find((r) => r.id === id), found: ok, evidence, qs });
  const seen = rows.filter((r) => r.visits);

  // 1. Time sink ---------------------------------------------------------
  const sinks = seen.filter((r) => r.timeSec > T.timeSink * r.expectedSec).sort((a, b) => b.timeRatio - a.timeRatio);
  if (sinks.length) {
    const w = sinks[0];
    const extra = sum(sinks.map((r) => r.timeSec - r.expectedSec));
    add({
      id: 'timeSink', name: 'Time sink', severity: 1 + extra / 120,
      headline: `Question ${w.n} took ${fmtDur(w.timeSec)} against about ${fmtDur(w.expectedSec)} expected. Skipping and returning is cheaper.`,
      detail: sinks.length > 1
        ? `${plural(sinks.length, 'question')} ran past twice their expected time, about ${fmtDur(extra)} over in total.`
        : `That is ${fmtDur(extra)} more than expected on one question.`,
      qs: sinks.map((r) => r.n),
    });
    check('timeSink', true, `${plural(sinks.length, 'question')} past ${T.timeSink}× expected; worst Q${w.n} at ${fix(w.timeRatio, 1)}×.`, sinks.map((r) => r.n));
  } else if (seen.length) {
    const w = [...seen].sort((a, b) => b.timeRatio - a.timeRatio)[0];
    check('timeSink', false, `Longest relative stop was Q${w.n} at ${fix(w.timeRatio, 1)}× expected (${fmtDur(w.timeSec)} vs ${fmtDur(w.expectedSec)}).`, [w.n]);
  } else check('timeSink', false, 'No question was opened.');

  // 2. Panic skipping -----------------------------------------------------
  // "Hard" = a long dwell (1.5x expected or more) or one the student tagged Panicked.
  const isHard = (v) => v.sec > 1.5 * v.row.expectedSec || v.row.tag === 'panicked';
  const runs = [];
  let longestRun = 0, hardStops = 0;
  for (let i = 0; i < vis.length; i++) {
    if (!isHard(vis[i])) continue;
    hardStops++;
    const run = [];
    let j = i + 1;
    while (j < vis.length && vis[j].sec < T.panicSkipSec && !vis[j].saved) { run.push(vis[j]); j++; }
    longestRun = Math.max(longestRun, run.length);
    if (run.length >= T.panicRun) { runs.push({ trigger: vis[i], run }); i = j - 1; }
  }
  if (runs.length) {
    const qs = [...new Set(runs.flatMap((r) => r.run.map((v) => v.row.n)))];
    const runRows = [...new Set(runs.flatMap((r) => r.run.map((v) => v.row)))];
    const worth = sum(runRows.map((r) => r.maxMarks));
    const laterRight = runRows.filter((r) => r.correct);
    const first = runs[0];
    add({
      id: 'panicSkip', name: 'Panic skipping', severity: 1.2 + runRows.length * 0.3,
      headline: `Right after question ${first.trigger.row.n}, you moved through ${plural(first.run.length, 'question')} in under ${T.panicSkipSec}s each without answering.`,
      detail: `Those questions were worth ${worth} marks. You later got ${laterRight.length} of ${runRows.length} right${laterRight.length ? `, so ${sum(laterRight.map((r) => r.maxMarks))} marks were within reach` : ''}.`,
      qs,
      triggers: runs.map((r) => r.trigger.row.n),
    });
    check('panicSkip', true, `${plural(runs.length, 'run')} of quick skips after a long stop (Q${runs.map((r) => r.trigger.row.n).join(', Q')}).`, qs);
  } else {
    check('panicSkip', false, hardStops
      ? `${plural(hardStops, 'long stop')}, but the longest run of sub-${T.panicSkipSec}s skips afterwards was ${longestRun} (rule needs ${T.panicRun}).`
      : 'No stop long enough to trigger a skip run.');
  }

  // 3. Freeze --------------------------------------------------------------
  const freezes = [];
  let longestIdle = null;
  vis.forEach((v, k) => {
    for (const e of v.events.filter((x) => x.type === 'idle')) {
      if (!longestIdle || e.dur > longestIdle.dur) longestIdle = { dur: e.dur, n: v.row.n };
    }
    const longIdle = v.events.filter((e) => e.type === 'idle' && e.dur / 1000 > T.freezeIdleSec);
    if (longIdle.length && !v.saved) freezes.push({ v, k, kind: 'idle', sec: Math.max(...longIdle.map((e) => e.dur / 1000)) });
    for (const e of v.events.filter((x) => x.type === 'focus' && x.dur >= 3000)) freezes.push({ v, k, kind: 'blur', sec: e.dur / 1000 });
  });
  if (freezes.length) {
    const lines = freezes.slice(0, 4).map((f) => {
      const next = vis[f.k + 1];
      const where = f.kind === 'idle' ? `${fmtDur(f.sec)} with no input on question ${f.v.row.n}` : `the tab lost focus for ${fmtDur(f.sec)} on question ${f.v.row.n}`;
      const later = f.v.row.attempted && f.v.row.lastAnswerAt > f.v.end;
      const then = next ? `then you moved to question ${next.row.n}${later ? ` (you came back and answered ${f.v.row.n} later)` : ''}` : 'and the test ended';
      return `${where}, ${then}`;
    });
    add({
      id: 'freeze', name: 'Freeze', severity: 0.8 + sum(freezes.map((f) => f.sec)) / 180,
      headline: lines[0].charAt(0).toUpperCase() + lines[0].slice(1) + '.',
      detail: lines.length > 1 ? `Also: ${lines.slice(1).join('; ')}.` : '',
      qs: [...new Set(freezes.map((f) => f.v.row.n))],
    });
    check('freeze', true, `${plural(freezes.length, 'freeze')}: ${freezes.filter((f) => f.kind === 'idle').length} idle, ${freezes.filter((f) => f.kind === 'blur').length} lost focus.`, [...new Set(freezes.map((f) => f.v.row.n))]);
  } else {
    const blurs = vis.flatMap((v) => v.events.filter((e) => e.type === 'focus'));
    check('freeze', false, `${longestIdle ? `Longest gap with no input: ${fmtDur(longestIdle.dur / 1000)} on Q${longestIdle.n} (rule fires at ${fmtDur(T.freezeIdleSec)} without an answer)` : `No gap without input longer than ${T.idleMinSec}s`}; ${blurs.length ? `the tab lost focus ${plural(blurs.length, 'time')}, briefly` : 'the tab never lost focus'}.`, longestIdle ? [longestIdle.n] : []);
  }

  // 4. Second-guessing ----------------------------------------------------------
  const flipRows = rows.filter((r) => r.flipsRW > 0);
  const totalChanges = sum(rows.map((r) => r.changes));
  if (flipRows.length) {
    const flips = sum(flipRows.map((r) => r.flipsRW));
    const lostRows = flipRows.filter((r) => r.flipLost);
    const lost = sum(lostRows.map((r) => r.maxMarks - r.marks));
    add({
      id: 'secondGuess', name: 'Second-guessing', severity: 0.9 + lost / 4,
      headline: `You changed a right answer to a wrong one ${plural(flips, 'time')}.`,
      detail: lost ? `Those changes cost ${lost} marks (the correct marks plus the negative mark).` : 'You changed back in time, so no marks were lost, but it cost time.',
      qs: flipRows.map((r) => r.n),
    });
    check('secondGuess', true, `${plural(flips, 'right→wrong change')} out of ${plural(totalChanges, 'answer change')}.`, flipRows.map((r) => r.n));
  } else {
    check('secondGuess', false, totalChanges ? `${plural(totalChanges, 'answer change')}, none from right to wrong.` : 'No answer was changed after being chosen.', rows.filter((r) => r.changes).map((r) => r.n));
  }

  // 5. Late-test collapse ------------------------------------------------------
  const total = s.elapsedMs;
  if (rows.length >= 8 && total > 5 * 60000) {
    const cut = total * (1 - T.lateFrac);
    const answered = rows.filter((r) => r.attempted && r.lastAnswerAt != null);
    const early = answered.filter((r) => r.lastAnswerAt <= cut);
    const late = answered.filter((r) => r.lastAnswerAt > cut);
    const accE = early.length ? early.filter((r) => r.correct).length / early.length : null;
    const accL = late.length ? late.filter((r) => r.correct).length / late.length : null;
    const paceE = early.length / (cut / 60000);
    const paceL = late.length / ((total - cut) / 60000);
    const leftAtCut = rows.length - early.length;
    const accDrop = accE != null && accL != null && late.length >= 3 && accE - accL >= T.lateAccDrop;
    const paceDrop = early.length >= 5 && leftAtCut >= 3 && paceL < (1 - T.latePaceDrop) * paceE;
    const curve = [0, 1, 2, 3, 4].map((b) => {
      const lo = (total * b) / 5, hi = (total * (b + 1)) / 5;
      const inBin = answered.filter((r) => r.lastAnswerAt > lo && r.lastAnswerAt <= hi);
      return { answered: inBin.length, accuracy: inBin.length ? inBin.filter((r) => r.correct).length / inBin.length : null };
    });
    if (accDrop || paceDrop) {
      const parts = [];
      if (accDrop) parts.push(`accuracy fell from ${Math.round(accE * 100)}% to ${Math.round(accL * 100)}%`);
      if (paceDrop) parts.push(`pace fell from ${paceE.toFixed(1)} to ${paceL.toFixed(1)} answers a minute`);
      add({
        id: 'lateCollapse', name: 'Late-test collapse', severity: 1 + (accDrop ? (accE - accL) * 3 : 0.5),
        headline: `In the last 20% of the test, ${parts.join(' and ')}.`,
        detail: 'The fatigue curve shows accuracy and answers per fifth of the test.',
        qs: late.map((r) => r.n),
        curve,
      });
      check('lateCollapse', true, parts.join('; ') + '.', late.map((r) => r.n));
    } else {
      check('lateCollapse', false, `Last 20%: ${accL == null ? 'no answers' : `${Math.round(accL * 100)}% accuracy`} vs ${accE == null ? 'none' : `${Math.round(accE * 100)}%`} before; pace ${paceL.toFixed(1)} vs ${paceE.toFixed(1)} answers a minute.`, late.map((r) => r.n));
    }
  } else check('lateCollapse', false, 'Checked only on tests with 8+ questions and 5+ minutes.');

  // 6. Subject-switch cost ------------------------------------------------------
  const firsts = [];
  const seenQ = new Set();
  for (const v of vis) if (!seenQ.has(v.q)) { seenQ.add(v.q); firsts.push(v); }
  const normal = median(firsts.map((v) => v.sec / v.row.expectedSec));
  const switches = [];
  let switchCount = 0, worstRatio = 0;
  for (let i = 1; i < firsts.length; i++) {
    if (firsts[i].row.subject === firsts[i - 1].row.subject) continue;
    switchCount++;
    const block = [];
    for (let j = i; j < firsts.length && block.length < 3 && firsts[j].row.subject === firsts[i].row.subject; j++) block.push(firsts[j]);
    if (block.length < 2) continue;
    const ratio = mean(block.map((v) => v.sec / v.row.expectedSec));
    if (normal > 0) worstRatio = Math.max(worstRatio, ratio / normal);
    if (normal > 0 && ratio > T.switchCost * normal) {
      const extra = sum(block.map((v) => Math.max(0, v.sec - normal * v.row.expectedSec)));
      switches.push({ from: firsts[i - 1].row.subject, to: firsts[i].row.subject, extra, qs: block.map((v) => v.row.n) });
    }
  }
  if (switches.length) {
    const extra = sum(switches.map((x) => x.extra));
    add({
      id: 'switchCost', name: 'Subject-switch cost', severity: 0.7 + extra / 150,
      headline: `After switching subjects, your first questions took over ${T.switchCost}× your normal time.`,
      detail: switches.map((x) => `${x.from} → ${x.to}: about ${fmtDur(x.extra)} of warm-up`).join(' · '),
      qs: switches.flatMap((x) => x.qs),
    });
    check('switchCost', true, `${plural(switches.length, 'costly switch', 'costly switches')} of ${switchCount}; about ${fmtDur(extra)} of warm-up in total.`, switches.flatMap((x) => x.qs));
  } else {
    check('switchCost', false, switchCount ? `${plural(switchCount, 'subject switch', 'subject switches')}; the first questions after a switch took at most ${fix(worstRatio, 1)}× your normal time (rule fires at ${T.switchCost}×).` : 'No subject switches in this paper.');
  }

  // 7. Opening jitters ---------------------------------------------------------------
  const fOrder = firsts.map((v) => v.row).filter((r) => r.F != null);
  if (fOrder.length >= 8) {
    const medF = median(fOrder.map((r) => r.F));
    const first5 = fOrder.slice(0, 5);
    const m5 = mean(first5.map((r) => r.F));
    if (m5 > medF + T.jitterMargin) {
      let settled = null;
      for (let k = 5; k + 2 < fOrder.length + 1; k++) {
        const win = fOrder.slice(k - 2, k + 1);
        if (win.length === 3 && mean(win.map((r) => r.F)) <= medF + 0.25) { settled = k; break; }
      }
      add({
        id: 'jitters', name: 'Opening jitters', severity: 0.6 + (m5 - medF),
        headline: `Friction on your first five questions was well above your median for this test.`,
        detail: settled ? `You settled after about ${plural(settled, 'question')}.` : 'Friction stayed high past the opening.',
        qs: first5.map((r) => r.n),
      });
      check('jitters', true, `First five: mean friction ${fix(m5)} vs test median ${fix(medF)}.`, first5.map((r) => r.n));
    } else check('jitters', false, `First five questions: mean friction ${fix(m5)} vs test median ${fix(medF)} (rule fires at +${T.jitterMargin}).`, first5.map((r) => r.n));
  } else check('jitters', false, 'Checked only on tests with 8+ questions and friction scores.');

  return { found: found.sort((a, b) => b.severity - a.severity), checks };
}

export const detectPatterns = (s, rows, visits) => analyzePatterns(s, rows, visits).found;

export const EXPERIMENTS = {
  timeSink: { title: 'Try a two-pass approach', body: 'First pass: answer what you can within its expected time, and mark-and-move once a question reaches 1.5× expected. Second pass: return to marked questions with the time you saved.' },
  panicSkip: { title: 'Reset after a hard question', body: 'When a question drags, take one slow breath and read the next question all the way through before deciding to skip it.' },
  freeze: { title: 'Set a stuck rule', body: 'If you have written nothing for 60 seconds, mark the question and move on. It will still be there on your second pass.' },
  secondGuess: { title: 'Change an answer only with a reason', body: 'Before changing an answer, name the specific error in your first attempt. No named error, no change.' },
  lateCollapse: { title: 'Plan the last 20%', body: 'Note the clock time at 80% of the paper. Take a 20-second stretch there and keep quick wins from your strongest subject for the end.' },
  switchCost: { title: 'Warm up each subject', body: 'Open each new subject with its easiest-looking question to get back up to speed before the harder ones.' },
  jitters: { title: 'Open with your strongest section', body: 'Start the paper with the subject you are most fluent in, so the first few minutes build momentum.' },
};
