// Local-first persistence. Everything lives on this device (localStorage).
// Numeric summaries go to an outbox that "syncs" when the network returns —
// the prototype has no server, so sync is simulated and nothing leaves the browser.
import { DEFAULT_TEMPLATES } from './data/templates.js';
import { DEFAULT_PREFS } from './config.js';

const KEY = 'exam-insight/v1';
const blank = () => ({
  profile: null,
  sessions: {},
  templateOverrides: {},
  tagDecisions: {},
  notes: {},
  resolved: {},
  planChecks: {},
  outbox: [],
  // Mentor workspace (the prototype keeps both roles on one device): assignments, notes, calls.
  mentor: { assignments: [], notes: [], spoken: {} },
  meta: { createdAt: Date.now(), version: 3 },
});

let state = load();
let saveTimer = null;
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = { ...blank(), ...JSON.parse(raw) }; s.mentor = { assignments: [], notes: [], spoken: {}, ...(s.mentor || {}) }; return s; }
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return blank();
}

function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    lastSavedAt = Date.now();
  } catch (e) {
    console.error('Save failed', e);
    window.dispatchEvent(new CustomEvent('ei:save-error'));
  }
  listeners.forEach((fn) => fn());
}
let lastSavedAt = null;

export const kindOf = (s) => s.kind || 'mock';

export const store = {
  get state() { return state; },
  get lastSavedAt() { return lastSavedAt; },
  onSave(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  save({ immediate = false } = {}) {
    if (immediate) return writeNow();
    if (!saveTimer) saveTimer = setTimeout(writeNow, 300);
  },
  flush() { if (saveTimer) writeNow(); },

  // profile
  get profile() { return state.profile; },
  get prefs() { return { ...DEFAULT_PREFS, ...(state.profile?.prefs || {}) }; },
  setProfile(p) { state.profile = p; writeNow(); },
  updateProfile(patch) { state.profile = { ...state.profile, ...patch }; writeNow(); },
  setPref(key, value) { this.updateProfile({ prefs: { ...this.prefs, [key]: value } }); },

  // sessions
  session(id) { return state.sessions[id] || null; },
  putSession(s, opts) { state.sessions[s.id] = s; this.save(opts); },
  deleteSession(id) { delete state.sessions[id]; writeNow(); },
  sessions({ exam, status, analytics, kind } = {}) {
    return Object.values(state.sessions)
      .filter((s) => (!exam || s.exam === exam)
        && (!status || [].concat(status).includes(s.status))
        && (!analytics || s.analytics === analytics)
        && (!kind || kindOf(s) === kind))
      .sort((a, b) => (a.startedAt || a.createdAt) - (b.startedAt || b.createdAt));
  },
  inProgress() {
    return Object.values(state.sessions).find((s) => s.status === 'in-progress' || s.status === 'ready') || null;
  },

  // templates
  templates() {
    return DEFAULT_TEMPLATES.map((t) => ({ ...t, ...(state.templateOverrides[t.id] || {}), overridden: !!state.templateOverrides[t.id] }));
  },
  template(id) { return this.templates().find((t) => t.id === id) || null; },
  saveTemplate(id, patch) { state.templateOverrides[id] = patch; writeNow(); },
  resetTemplate(id) { delete state.templateOverrides[id]; writeNow(); },

  // question-bank tag approvals (teacher queue)
  tagDecision(qid) { return state.tagDecisions[qid] || null; },
  setTagDecision(qid, d) { state.tagDecisions[qid] = d; writeNow(); },

  // mistake log
  note(qid) { return state.notes[qid] || ''; },
  setNote(qid, text) { if (text) state.notes[qid] = text; else delete state.notes[qid]; this.save(); },
  resolvedAt(qid) { return state.resolved[qid] || null; },
  setResolved(qid, on) { if (on) state.resolved[qid] = Date.now(); else delete state.resolved[qid]; writeNow(); },

  // weekly plan ticks
  planCheck(key) { return !!state.planChecks[key]; },
  setPlanCheck(key, on) { if (on) state.planChecks[key] = Date.now(); else delete state.planChecks[key]; writeNow(); },

  // outbox of numeric summaries (only with consent)
  queueSummary(summary) {
    if (!state.profile?.consent?.sync) return;
    state.outbox.push({ ...summary, queuedAt: Date.now(), syncedAt: null });
    this.save();
  },
  pendingSync() { return state.outbox.filter((x) => !x.syncedAt).length; },
  flushOutbox() {
    if (!navigator.onLine) return 0;
    let n = 0;
    for (const item of state.outbox) if (!item.syncedAt) { item.syncedAt = Date.now(); n++; }
    if (n) this.save();
    return n;
  },

  // mentor workspace
  get mentor() { return state.mentor; },
  addAssignment(a) {
    const rec = { id: `as_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now(), done: {}, ...a };
    state.mentor.assignments.unshift(rec);
    writeNow();
    return rec;
  },
  updateAssignment(id, patch) { const a = state.mentor.assignments.find((x) => x.id === id); if (a) { Object.assign(a, patch); writeNow(); } },
  assignmentsFor(studentId) { return state.mentor.assignments.filter((a) => a.studentIds.includes(studentId)); },
  addNote(n) { state.mentor.notes.unshift({ id: `mn_${Date.now().toString(36)}`, at: Date.now(), ...n }); writeNow(); },
  notesFor(studentId) { return state.mentor.notes.filter((n) => n.studentId === studentId); },
  /** Notes a mentor left for the student on this device, for one test (or general notes). */
  mentorNotesFor(sessionId) { return state.mentor.notes.filter((n) => n.studentId === 'you' && (n.sessionId === sessionId)); },
  markSpoken(studentId, note = '') { (state.mentor.spoken[studentId] ||= []).unshift({ at: Date.now(), note }); writeNow(); },
  spokenTo(studentId) { return state.mentor.spoken[studentId] || []; },

  exportAll() { return JSON.stringify(state, null, 2); },
  reset() { state = blank(); localStorage.removeItem(KEY); listeners.forEach((fn) => fn()); },
};

window.addEventListener('pagehide', () => store.flush());
window.addEventListener('online', () => store.flushOutbox());
