# Exam Insight — prototype

A NEET/JEE practice app built around **facial-expression behaviour analysis**. The camera reads the student's face while they attempt the paper. Afterwards the behaviour map shows, question by question and topic by topic, where they struggled, and what kind of struggle it was. A mentor workspace turns the same data into "what to re-teach" for a batch.

No build step, no dependencies. Plain ES modules; installable as a PWA; works offline once the camera models are cached.

## Run it

```bash
node serve.mjs 5310
```

- On this computer: http://localhost:5310
- On a phone on the same Wi-Fi, **with camera**: `https://<LAN-IP>:5311`. The server prints the address. Browsers only allow the camera on https or localhost, so `serve.mjs` also serves HTTPS on port + 1 when `.cert/key.pem` and `.cert/cert.pem` exist. The certificate is self-signed: tap Advanced → Proceed once.
- From the Claude desktop app, the `exam-insight` entry in `../.claude/launch.json` starts the same server.

`.cert/` is git-ignored (it holds a private key), so a fresh clone has no certificate. Create one, and again whenever the LAN address changes, putting your LAN IP in place of `<LAN-IP>`:

```bash
mkdir -p .cert
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout .cert/key.pem -out .cert/cert.pem -days 825 -subj "/CN=Exam Insight dev" -addext "subjectAltName=IP:<LAN-IP>,IP:127.0.0.1,DNS:localhost"
```

On the welcome screen: **NEET demo** / **JEE demo** load a sample student with four past mocks (with behaviour maps); **I'm a mentor** opens the mentor workspace with four sample batches (258 students).

## The flow

1. **Profile → consent → camera room.** Camera-based behaviour analysis is the one required consent (a verified parent's, for under-18s). Mentor sharing and flag snapshots are optional.
2. **Choose a paper.** The paper page is a cover sheet with one way in: the camera room. NEET starts with **Biology · Class 10 demo** (12 simple Class 10 NCERT questions, about five minutes).
3. **Camera room** (`#/room/:sid`). The paper waits until the face is clearly readable.
   - First time (or when the calibration is stale): **light & framing → calm face (6 s) → frown (3 s) → pressed lips (3 s) → five screen dots → writing posture**. Saved as `profile.calibration` (v2) plus the admit-card photo and face signatures.
   - Every test: light & framing, only you, it's you, no phone, then a five-second calm baseline for that sitting.
4. **The paper.** Every second of test time gets a state (reading, writing, looking away, face absent, picture too poor) and, while reading, a strain level. A pill in the test bar shows what the camera sees; a quiet banner appears if the face can't be read for more than eight seconds; if the camera stops, the clock pauses.
5. **The behaviour map** (result page): §1 where you struggled (question strip), §2 four kinds of question, §3 topics that strained you, §4 what your face showed (insights), §5 minute by minute. Marks, timing and the full log are folded below.

## Face quality: why a washed-out face can't get through

`js/face/quality.js` measures a 96×96 crop of the inner face on every frame: mean and spread of brightness, clipped-white and crushed-black share, left/right balance, Laplacian variance (sharpness), plus the whole-frame brightness for back-light. `assessFrame(sample, 'room' | 'test')` returns a verdict with plain-language fixes:

| Issue | Rule (room) | Message |
|---|---|---|
| Washed out | > 5% clipped whites, or mean > 172 with spread < 26, or mean > 218 | Too much light on your face |
| Too dark | mean < 45, or mean < 58 with crushed blacks or no detail | Too dark to read your face |
| Back-lit | frame − face > 42 and face < 128 | The light is behind you |
| Flat | spread < 12 (block), < 18 (warn) | Your face looks flat and grey |
| One-sided | balance > 0.5 (block), > 0.3 (warn) | Light falls on one side |
| Blurry | Laplacian variance < 14 (block), < 40 (warn) | The picture is blurry |
| Framing | width 0.2–0.6 of the frame, centred, facing the screen | Move closer / left / sit up… |

Brightness alone never decides "too dark", so a darker skin tone in good light is not flagged. During a test the thresholds are more lenient, and frames that still fail are left out of the analysis (shown as gaps). All thresholds live in `config.js` (`QUALITY`).

## The expression model

`js/face/expression.js`. Struggle-relevant actions from MediaPipe blendshapes: brow furrow, lip press, eye squint, mouth corners down, inner brow raise, nose wrinkle. Each is scaled between the student's own calm face and their own range from the calibration tasks. Strain per frame = 0.6 × the strongest single channel + 0.4 × the weighted blend (people show effort in different channels). It is a measure of visible effort, never an emotion label.

States: **writing** uses the learned writing posture (sign-agnostic) or eyes looking down; **away** uses the learned screen envelope (minimum ±10° yaw, ±8° pitch, since many students look at corners with their eyes only); a face that leaves the frame right after writing is still writing (up to 45 s if calibration showed the face drops out when writing).

## The behaviour engine

`js/engine/behaviour.js` turns the per-second trace and the visits into, per question: reading/writing/away seconds, strained seconds, onset, peak, pre-answer strain, the facial actions that carried it, and a **struggle index** (0–100). Against the outcome that gives the four kinds:

| | Correct | Wrong |
|---|---|---|
| **Calm** | Mastered | Blind spot (a misconception you can't feel) |
| **Strained** | Fragile (knows it, but it costs) | Gap |

plus *avoided* (strained, then skipped) and calm skips. Insights: the hardest moment, fragile answers, blind spots, spillover (strain on the next two questions after a hard one), onset (strain before trying vs stuck mid-solve), pressure answers (wrong answers committed while strained), stamina (first third vs last third), recovery time, subject differences, avoidance.

## Mentor workspace

`#/mentor` (its own header; code loads only when opened). Built for a mentor or counsellor with 100–500 students on a laptop.

- **Re-teach**: the latest mock's questions in re-teach order, with the answer distribution (the common trap answer flagged), how many faces strained, and plain-English reasons. One click assigns a drill to everyone who missed it. Topics ranked alongside; every question as a heat strip.
- **Teach**: one question ready for class, with a Present mode, and who to follow up with by kind.
- **Students**: each student against their own past (score and struggle deltas, trend, reasons to look). No ranks, no leaderboard. Real names (simulated).
- **Student**: their behaviour map per mock (third person), proctoring flags with snapshots (if they agreed), notes, "spoken to", practice.
- **Assignments**: what was sent and how far each group has got. Assignments and notes for the student on this device show on their home page.

The sample cohort (`js/data/roster.js`, `js/engine/mentor.js`) is simulated through the same engine as real tests: every student in a batch sits the same paper.

## Files

| Area | Where |
|---|---|
| Camera room (calibration + room check) | `js/views/room.js`, `js/views/faceart.js`, `css/room.css` |
| Face layer, quality, expression model, checks | `js/face/facelayer.js`, `quality.js`, `expression.js`, `proctor.js`, `identity.js`, `objects.js`, `mic.js` |
| Test runner (CBT and OMR) with the expression trace | `js/views/runner.js` |
| Behaviour engine | `js/engine/behaviour.js` |
| Behaviour renderers (strip, quadrants, topics, insights, chart) | `js/views/bxui.js`, `css/behaviour.css` |
| Result page, drill result, progress | `js/views/report.js`, `drillresult.js`, `history.js` |
| Home, paper page, first run | `js/views/home.js`, `start.js`, `onboarding.js`, `css/desk.css` |
| Mentor workspace | `js/views/mentor.js`, `css/mentor.css`, `js/engine/mentor.js`, `js/data/roster.js` |
| Demo data generator (events + traces) | `js/engine/simulate.js` |
| Question banks: standard, test-drive, Class 10 | `js/data/questions.js`, `questions-easy.js`, `questions-class10.js` |
| Design system (exam hall: paper, ink, saffron) | `css/app.css` (tokens, light and night-ink themes) |
| Every threshold and weight | `js/config.js` |

v1–v4 analytics (friction index, patterns, minute-by-minute replay, topic groups, mistake log, drills) still run and sit in the result page's fold.

## Policy defaults

- Under-18 accounts need a verified parent's consent to camera-based analysis. `POLICY.UNDER18_CAMERA` / `UNDER18_BEHAVIOUR_LAYER` can be set to `false` if the pending legal opinion says in-test behavioural monitoring of children isn't allowed under DPDP s.9; under-18 setup then stops at a clear message.
- Face data never leaves the tab. Stored: per-second strain and state, per-question action shares, the calibration, one admit-card photo and face signatures, proctoring notes, and with consent one small photo per flag. Never: video or audio, the screen, emotion labels.
- Tele-MANAS number (14416) is in `config.js`. Confirm it before shipping.

## Simulated in this prototype

- No server. Data lives in `localStorage`; "sync" only marks the outbox as sent.
- Parent verification is a stand-in for a DigiLocker virtual token.
- The mentor's batches, attempt statistics and cohort percentiles are synthetic.
- Thresholds are first guesses, tuned on a test portrait and synthetic images; they need tuning on real webcams and real students.

Testing without a webcam (the browser pane): fetch `https://storage.googleapis.com/mediapipe-assets/portrait.jpg` (CORS ok), draw the crop `x 112, y 8, w 580, h 435` onto a 640×480 canvas on an interval, and override `navigator.mediaDevices.getUserMedia` to return `canvas.captureStream(10)`. A `brightness(2.3) contrast(0.55)` canvas filter reproduces a washed-out face; `brightness(0.28)` a dark room; `blur(5px)` a blurry lens.
