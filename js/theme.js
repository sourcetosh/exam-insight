// Theme and motion preferences, applied as attributes on <html> so CSS can key off them.
import { store } from './store.js';

export function applyTheme() {
  const prefs = store.prefs;
  const html = document.documentElement;
  if (prefs.theme === 'light' || prefs.theme === 'dark') html.dataset.theme = prefs.theme;
  else delete html.dataset.theme;
  if (prefs.motion === 'reduce') html.dataset.motion = 'reduce';
  else delete html.dataset.motion;
  try { localStorage.setItem('ei-theme', prefs.theme); } catch { /* ignore */ }
}

/** Current effective theme ("light" | "dark"). */
export function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const cur = store.prefs.theme;
  const next = order[(order.indexOf(cur) + 1) % order.length];
  if (store.profile) store.setPref('theme', next);
  else { try { localStorage.setItem('ei-theme', next); } catch { /* ignore */ } }
  applyTheme();
  return next;
}
