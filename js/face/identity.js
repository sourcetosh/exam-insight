// Identity check: is the person at the camera the one who enrolled?
// Uses @vladmandic/face-api (MIT, free): a 128-number face signature per frame, compared
// with the signatures captured at enrolment. Signatures are numbers, not images, and
// stay on this device. Loaded lazily; if the CDN is unreachable the check is skipped.
import { PROCTOR } from '../config.js';

const VER = '1.7.15';
const BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VER}`;

export const identity = {
  state: 'idle', // idle | loading | ready | error
  error: null,
  api: null,
  _p: null,

  load() {
    if (this.api) return Promise.resolve(this.api);
    if (this._p) return this._p;
    this.state = 'loading';
    this._p = (async () => {
      try {
        const mod = await import(/* @vite-ignore */ `${BASE}/dist/face-api.esm.js`);
        const f = mod.nets ? mod : mod.default;
        await Promise.all([
          f.nets.tinyFaceDetector.loadFromUri(`${BASE}/model`),
          f.nets.faceLandmark68TinyNet.loadFromUri(`${BASE}/model`),
          f.nets.faceRecognitionNet.loadFromUri(`${BASE}/model`),
        ]);
        this.api = f;
        this.state = 'ready';
        return f;
      } catch (e) {
        this.state = 'error';
        this.error = e;
        this._p = null;
        throw e;
      }
    })();
    return this._p;
  },

  /** 128-number signature of the single most prominent face in a video/canvas, or null. */
  async describe(source) {
    const f = this.api || await this.load();
    const opts = new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
    const det = await f.detectSingleFace(source, opts).withFaceLandmarks(true).withFaceDescriptor();
    return det ? Array.from(det.descriptor) : null;
  },

  distance(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  },

  /** Smallest distance to any enrolled signature, and the verdict for it. */
  compare(desc, enrolled) {
    if (!desc || !enrolled?.length) return { distance: null, verdict: null };
    const distance = Math.min(...enrolled.map((e) => this.distance(desc, e)));
    const T = PROCTOR.identity;
    return { distance, verdict: distance < T.match ? 'match' : distance < T.unsure ? 'unsure' : 'mismatch' };
  },
};
