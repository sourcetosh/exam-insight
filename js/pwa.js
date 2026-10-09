// Installable, offline-capable shell. The service worker caches the app files;
// everything the student does is already local, so a dropped connection changes nothing.
export const pwa = { canInstall: false, installed: false, swReady: false, prompt: null, async install() { return false; } };

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pwa.prompt = e;
  pwa.canInstall = true;
  window.dispatchEvent(new CustomEvent('ei:pwa'));
});
window.addEventListener('appinstalled', () => { pwa.installed = true; pwa.canInstall = false; window.dispatchEvent(new CustomEvent('ei:pwa')); });
pwa.installed = matchMedia('(display-mode: standalone)').matches;
pwa.install = async () => {
  if (!pwa.prompt) return false;
  pwa.prompt.prompt();
  const { outcome } = await pwa.prompt.userChoice;
  pwa.prompt = null;
  pwa.canInstall = false;
  return outcome === 'accepted';
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    pwa.swReady = !!(reg.active || reg.installing || reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new CustomEvent('ei:update')); });
    });
  }).catch(() => {});
}
