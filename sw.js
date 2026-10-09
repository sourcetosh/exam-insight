// Service worker: cache the app shell on install. Same-origin requests go network-first
// (so updates show immediately) and fall back to the cache offline; fonts are cache-first.
const VERSION = 'ei-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/views.css', 'css/v2.css', 'css/simple.css', 'css/proctor.css', 'css/room.css', 'css/behaviour.css', 'css/desk.css', 'css/mentor.css',
  'js/main.js', 'js/ui.js', 'js/config.js', 'js/store.js', 'js/icons.js', 'js/theme.js', 'js/pwa.js',
  'js/data/questions.js', 'js/data/questions-easy.js', 'js/data/questions-class10.js', 'js/data/roster.js', 'js/data/bank.js', 'js/data/taxonomy.js', 'js/data/templates.js', 'js/data/cohort.js',
  'js/engine/paper.js', 'js/engine/scoring.js', 'js/engine/features.js', 'js/engine/friction.js', 'js/engine/topics.js', 'js/engine/patterns.js',
  'js/engine/report.js', 'js/engine/review.js', 'js/engine/simulate.js', 'js/engine/timeline.js', 'js/engine/insights.js', 'js/engine/narrative.js', 'js/engine/behaviour.js', 'js/engine/mentor.js',
  'js/face/facelayer.js', 'js/face/quality.js', 'js/face/expression.js', 'js/face/proctor.js', 'js/face/identity.js', 'js/face/objects.js', 'js/face/mic.js',
  'js/views/home.js', 'js/views/onboarding.js', 'js/views/start.js', 'js/views/calibrate.js', 'js/views/runner.js', 'js/views/review.js',
  'js/views/room.js', 'js/views/faceart.js', 'js/views/bxui.js', 'js/views/mentor.js',
  'js/views/report.js', 'js/views/replay.js', 'js/views/history.js', 'js/views/coach.js', 'js/views/templates.js', 'js/views/bank.js',
  'js/views/methods.js', 'js/views/privacy.js', 'js/views/charts.js', 'js/views/drill.js', 'js/views/drillresult.js', 'js/views/mistakes.js',
  'js/views/settings.js', 'js/views/palette.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const fonts = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');
  // Camera models and the vision bundle (MediaPipe, face-api) are large and versioned: cache them once, forever.
  const models = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com';
  if (!sameOrigin && !fonts && !models) return;
  const put = (res) => { if (res && res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone())).catch(() => {}); return res; };
  if (fonts || models) {
    e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request).then(put)));
    return;
  }
  e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request).then((cached) => cached || caches.match('index.html'))));
});
