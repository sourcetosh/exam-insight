// Tunable policy, weights and thresholds. Everything here is a starting guess
// to be tuned against self-report tags in the pilot (see plan, "Signals").

export const POLICY = {
  // DPDP Act s.9: a child's data needs verifiable parental consent, and the parent step
  // collects it for behaviour logging and for the camera separately. With both flags true
  // an under-18 account gets the full layer only when the parent ticked that box.
  // Whether in-test feedback counts as "behavioural monitoring" is still pending a
  // written legal opinion: flip these to false to fall back to scores + time only.
  UNDER18_BEHAVIOUR_LAYER: true,
  UNDER18_CAMERA: true,
  // Confirm before shipping.
  HELPLINE: { name: 'Tele-MANAS', number: '14416', alt: '1-800-891-4416' },
};

// Friction index weights: F = 0.35 z(t/t̂) + 0.20 z(r) + 0.15 z(c) + 0.15 z(i) + 0.15 z(f)
export const WEIGHTS = { time: 0.35, revisits: 0.2, changes: 0.15, idle: 0.15, face: 0.15 };

export const THRESHOLDS = {
  overExpected: 1.3,       // topic "over expected" when time ratio above this
  underExpected: 1.0,      // low-accuracy topics at or under this are "fast and wrong"
  lowAccuracy: 0.5,
  highFriction: 0.4,       // mean F above this = "high friction"
  minTopicQuestions: 5,    // flag a topic only after this many questions
  confirmTests: 3,         // early signal until the pattern repeats across this many tests
  ownHistoryAfter: 3,      // z against own history after this many tests, cohort before
  empiricalAttempts: 200,  // median correct time replaces template estimate after this

  timeSink: 2.0,           // x expected time
  panicSkipSec: 10,
  panicRun: 3,
  freezeIdleSec: 90,
  lateFrac: 0.2,
  lateAccDrop: 0.2,
  latePaceDrop: 0.3,
  switchCost: 1.5,
  jitterMargin: 0.5,
  idleMinSec: 15,          // shortest gap recorded as idle
  minVisitMs: 1200,        // paper mode: dwell needed before a scrolled-to question counts as viewed
};

export const DIFFICULTY_MULT = { 1: 0.7, 2: 1.0, 3: 1.5 };
export const DIFFICULTY_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

// Question banks. Test-drive and Class 10 items are trivially easy, so their expected time is scaled.
export const BANKS = {
  easy: { label: 'Test-drive', short: 'Easy', blurb: 'Very easy recall and reasoning questions, so you can try the analytics in minutes.' },
  standard: { label: 'Standard', short: 'Standard', blurb: 'NCERT / JEE Main / NEET level questions.' },
  class10: { label: 'Class 10', short: 'Class 10', blurb: 'Simple Class 10 NCERT Science (Biology) questions, for a first demo.' },
};
export const EASY_TIME_FACTOR = 0.5;
export const EASY_DURATION_MULT = 1.15;   // time allowed for an easy paper = sum of expected × this

export const DEFAULT_PREFS = { bank: 'easy', theme: 'system', paceHint: false, fullscreen: true, motion: 'system' };

// Topic drills: short timed sets that feed the same analytics.
export const DRILL = {
  size: 8,
  modes: {
    normal: { label: 'Normal', mult: 1.0, blurb: 'Expected time per question, like a mock.' },
    speed: { label: 'Speed', mult: 0.8, blurb: '80% of expected time. For slow-but-sure topics.' },
    slow: { label: 'Slow read', mult: 1.6, blurb: '160% of expected time. Read twice; for fast-and-wrong topics.' },
  },
};

// Synthetic pilot-cohort score distributions (fraction of max marks) per test format.
export const COHORT_DIST = {
  sprint: { mean: 0.44, sd: 0.2, n: 1284 },
  mini: { mean: 0.42, sd: 0.18, n: 2130 },
  full: { mean: 0.39, sd: 0.17, n: 3460 },
};

export const FACE = {
  fps: 5,                  // during a test
  checkFps: 8,             // during camera setup and the pre-test check (snappier guidance)
  lowLuma: 42,             // 0-255 mean frame brightness below which frames are dropped
  gazeYawDeg: 30,
  markerCap: 3,            // tension marker clipped to ±cap (in baseline units)
  minValidFrac: 0.3,       // per question: below this the face term is left out
  minSamples: 8,
  calibrationSec: 60,      // each of the two optional full-calibration phases
  insightMarker: 1.0,      // tension marker needed for a coinciding insight
  quickBaselineFrames: 12, // steady, aligned frames that make the quick baseline at the pre-check
};

// Face-signal quality. Expression reading is only as good as the picture, so the camera room
// refuses a washed-out, dark, back-lit, blurry or badly framed face, and during a test frames
// that fail the (more lenient) test thresholds are left out of the analysis.
// Measured on a 96x96 crop of the inner face: mean / sd of brightness (0-255), the share of
// clipped-white and crushed-black pixels, left/right balance, and Laplacian variance (sharpness).
export const QUALITY = {
  crop: 96,
  clipHi: 246,
  clipLo: 14,
  // washed = clipped whites, or very bright with detail gone; dark = dim with crushed blacks
  // (a darker skin tone in good light has few crushed pixels, so it is not penalised).
  room: {
    minW: 0.2, maxW: 0.6, cx: [0.34, 0.66], cy: [0.3, 0.7],
    hiMax: 0.05, brightMean: 172, washedSd: 26, veryBright: 218,
    darkMean: 58, darkLo: 0.06, veryDark: 45, loMax: 0.3,
    backlitGap: 42, backlitMean: 128, flatBlock: 12, flatWarn: 18,
    unevenWarn: 0.3, unevenBlock: 0.5, blurWarn: 40, blurBlock: 14,
    yaw: 22, pitch: 26, roll: 16, jitterWarn: 0.045,   // a phone or low laptop camera looks up at the face
  },
  test: {
    minW: 0.13, maxW: 0.8,
    hiMax: 0.12, brightMean: 180, washedSd: 22, veryBright: 232,
    darkMean: 48, darkLo: 0.1, veryDark: 32, loMax: 0.4,
    backlitGap: 55, backlitMean: 105, flatBlock: 9, flatWarn: 13,
    unevenWarn: 0.45, unevenBlock: 0.68, blurWarn: 22, blurBlock: 8,
  },
  holdMs: 2000,        // the room advances only after the picture has been good this long
};

// Expression reading: struggle-relevant facial actions from MediaPipe blendshapes, each scaled
// between the student's own neutral face and their own range (from the calibration tasks).
export const EXPRESSION = {
  weights: { brow: 0.38, press: 0.22, squint: 0.16, frown: 0.12, inner: 0.06, sneer: 0.06 },
  peakWeight: { brow: 1, press: 0.9, squint: 0.7, frown: 0.8, inner: 0.6, sneer: 0.7 },
  floor: { brow: 0.08, press: 0.08, squint: 0.08, frown: 0.06, inner: 0.08, sneer: 0.05 },
  deadbandSd: 1.0,     // ignore movement within one neutral SD
  strained: 0.35,      // a second at or above this strain counts as strained
  struggleIdx: 40,     // a question at or above this struggle index is "strained"
  minReadSec: 3,       // reading seconds needed before a question gets a struggle index
  calib: { neutralSec: 6, frownSec: 3, pressSec: 3, cornerSec: 1.3, paperSec: 2.5, settleSec: 5, staleDays: 21 },
  rangeMinGain: { brow: 0.05, press: 0.04 },   // a task must lift its component this far over neutral
  away: { yawMargin: 12, pitchMargin: 12, sideways: 0.62, minHalfYaw: 10, minHalfPitch: 8 },
  writing: { lookDown: 0.42, pitchMargin: 8, hiddenMaxSec: 45 },
};

// Proctoring: every check runs in the browser tab. Models load only when the camera is on.
export const PROCTOR = {
  // Where the face box (fractions of the frame) must sit to match the oval guide.
  box: { cxMin: 0.36, cxMax: 0.64, cyMin: 0.32, cyMax: 0.68, wMin: 0.2, wMax: 0.58 },
  pose: { yaw: 22, pitch: 24, roll: 18, sideways: 0.6 },   // allowed at the pre-check
  lookAway: { yaw: 28, sideways: 0.6 },                    // during the test (looking down is fine)
  luma: { dark: 60, bright: 228, backlit: 0.62 },          // face brightness; backlit = face / frame ratio
  steadyMs: 1500,          // aligned this long before enrolment captures / Start unlocks
  identity: { match: 0.55, unsure: 0.65, samples: 3, recheckSec: 25 },
  objects: { everyMs: 1500, score: 0.45, classes: ['cell phone', 'person', 'book'] },
  mic: { loudDb: -18, sustainMs: 2000 },
  // How long a condition must hold before it is logged, and how long it must clear before the flag closes.
  flags: {
    no_face: { onset: 2500, release: 1500, label: 'Face not visible', severity: 2 },
    multi_face: { onset: 1500, release: 2000, label: 'Another person in view', severity: 3 },
    look_away: { onset: 4000, release: 1500, label: 'Looked away from the screen', severity: 1 },
    phone: { onset: 1500, release: 3000, label: 'Phone in view', severity: 3 },
    identity: { onset: 0, release: 0, label: 'Face did not match the enrolment', severity: 3 },
    noise: { onset: 2000, release: 2000, label: 'Loud sound', severity: 1 },
    camera_lost: { onset: 3000, release: 3000, label: 'Camera unavailable', severity: 2 },
    blur: { label: 'Left the test window', severity: 2 },
    fs_exit: { label: 'Left full screen', severity: 1 },
  },
};

export const TAGS = [
  { id: 'sure', label: 'Sure', hint: 'I knew it' },
  { id: 'guessed', label: 'Guessed', hint: 'Took a chance' },
  { id: 'panicked', label: 'Panicked', hint: 'Lost my footing' },
  { id: 'blank', label: 'Blank', hint: 'No idea / skipped' },
];

export const REVIEW = { topFriction: 20, random: 10, softLimitSec: 300 };
