// Object check: a phone or a second person in the camera frame.
// MediaPipe Object Detector (EfficientDet-Lite0, COCO classes), on-device, a few times a
// second at most. Only class names and scores leave this module.
import { PROCTOR } from '../config.js';
import { getVision } from './facelayer.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

export const objects = {
  state: 'idle', // idle | loading | ready | error
  error: null,
  detector: null,
  lastTs: 0,
  lastAt: 0,
  last: null,
  _p: null,

  load() {
    if (this.detector) return Promise.resolve(this.detector);
    if (this._p) return this._p;
    this.state = 'loading';
    this._p = (async () => {
      try {
        const { vision, fileset } = await getVision();
        const opts = (delegate) => ({
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'VIDEO',
          scoreThreshold: PROCTOR.objects.score,
          maxResults: 8,
          categoryAllowlist: PROCTOR.objects.classes,
        });
        try { this.detector = await vision.ObjectDetector.createFromOptions(fileset, opts('GPU')); }
        catch { this.detector = await vision.ObjectDetector.createFromOptions(fileset, opts('CPU')); }
        this.state = 'ready';
        return this.detector;
      } catch (e) {
        this.state = 'error';
        this.error = e;
        this._p = null;
        throw e;
      }
    })();
    return this._p;
  },

  /** Run one detection on the live video. Returns the summary and keeps it as `last`. */
  detect(video) {
    if (!this.detector || !video || video.readyState < 2) return null;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const res = this.detector.detectForVideo(video, ts);
    const items = (res?.detections || []).map((d) => {
      const c = d.categories?.[0];
      return { name: c?.categoryName || '?', score: c?.score || 0, box: d.boundingBox || null };
    });
    const phone = items.filter((x) => x.name === 'cell phone').reduce((m, x) => Math.max(m, x.score), 0);
    const out = {
      at: ts,
      phone,
      persons: items.filter((x) => x.name === 'person').length,
      books: items.filter((x) => x.name === 'book').length,
      items,
    };
    this.last = out;
    this.lastAt = ts;
    return out;
  },
};
