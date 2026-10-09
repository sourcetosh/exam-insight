// Optional microphone level meter for the "quiet room" check. Audio is never recorded:
// a loudness number (dBFS) is computed ten times a second and discarded.
import { PROCTOR } from '../config.js';

export const mic = {
  state: 'idle', // idle | loading | running | denied | error | off
  level: -100,
  loudSince: null,
  _timer: null,

  async start() {
    if (this.state === 'running' || this.state === 'loading') return;
    this.state = 'loading';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      await this.ctx.resume().catch(() => {});
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 2048;
      this.src.connect(this.an);
      this.buf = new Float32Array(this.an.fftSize);
      this.state = 'running';
      this._timer = setInterval(() => this.sample(), 100);
    } catch (e) {
      this.state = e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError' ? 'denied' : 'error';
      this.error = e;
      this.stop(false);
    }
  },

  sample() {
    if (!this.an) return;
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    // Fast attack, slow release, so a sharp sound registers but the meter settles.
    this.level = db > this.level ? db : this.level * 0.85 + db * 0.15;
    const now = performance.now();
    if (this.level > PROCTOR.mic.loudDb) { if (this.loudSince == null) this.loudSince = now; }
    else this.loudSince = null;
  },

  /** True once the room has been loud for the sustain period. */
  get loud() { return this.loudSince != null && performance.now() - this.loudSince >= PROCTOR.mic.sustainMs; },

  stop(setOff = true) {
    clearInterval(this._timer);
    this._timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.src?.disconnect?.();
    this.ctx?.close?.().catch?.(() => {});
    this.ctx = null; this.an = null; this.src = null;
    this.level = -100;
    this.loudSince = null;
    if (setOff) this.state = 'off';
  },
};
