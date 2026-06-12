# timegrapher

## how this works (human only)

pipeline
- use sound frequency filter for specific range to reduce noise 
- extract envelope
- build folded feature rows for known standards
- use those folds as acquisition evidence for tracking
- track actual BPH / phase
- later: separate lock / unlock / drop features inside the folded tick packet

## code / detail architecture

### impl details of pipeline

This app is live browser recording only. There is no file import path in the
initial design.

Core idea:
- Use the audio stream sample count as the clock. Do not use `performance.now()`
  for measurement.
- Extract low-rate tick-energy features from the microphone stream.
- Fold those features against known watch standards as acquisition evidence.
- Track actual BPH / phase from the observed tick packets.
- Treat nominal standard as the known BPH nearest to tracked actual BPH.

Terms:
- `BPH`: beats per hour. Common standards: `14400`, `18000`, `19800`, `21600`,
  `25200`, `28800`, `36000`.
- `nominalInterval`: expected seconds between beats, `3600 / BPH`.
- `featureRate`: sample rate of the extracted feature stream, not the raw audio
  sample rate. Current target: `1000 Hz`.
- `period`: user-selected lookback duration, in seconds, used for folding and
  later tracking.

Initial file layout:

```txt
public/
  index.html
  main.ts
  data.ts
  graph.ts
  feature-worklet.js
  analysis-worker.ts
```

Run locally:

```sh
bun run dev
```

Check and build:

```sh
bun run check
bun run build
```

`index.html`:
- Requests microphone access.
- Creates the `AudioContext`, loads `feature-worklet.js`, and starts/stops the
  stream.
- Creates `analysis-worker.js`.
- Owns UI controls: period, sensitivity/debug controls, start/stop.
- Displays the standard fold heatmap and raw feature stream.

`data.ts`:
- Defines shared constants and pure analysis helpers.
- Does not touch the DOM.

`graph.ts`:
- Owns display only.
- Uses Apache ECharts for the heatmap and feature graph.
- Input is processed worker output, not raw audio.

`feature-worklet.js`:
- Runs inside an `AudioWorkletProcessor`.
- Receives raw microphone PCM.
- Maintains an absolute raw audio frame counter.
- Produces coarse frequency-band novelty features at `featureRate`.
- Posts feature batches to the main thread.

`analysis-worker.ts`:
- Receives feature batches from the main thread.
- Maintains rolling feature buffers.
- Runs folding for all candidate standards.
- Posts an `analysis` message with `standardFolds` and a future `tracking`
  field.

### runtime data flow

```txt
microphone
-> AudioWorkletProcessor feature extractor
-> main thread relay
-> Web Worker fold analysis
-> main thread graph/UI
```

The worklet should send feature batches, not raw 48 kHz audio. Example data
size at `1000 Hz`, `5` bands, `Float32`:

```txt
1000 feature frames/sec * 5 bands * 4 bytes = 20 KB/sec
```

Use transferable `ArrayBuffer`s when posting feature batches to avoid copies.

Feature batch message:

```js
{
  type: "features",
  startFrame: 123000,       // feature-frame index, not performance.now()
  rawFrame: 5904000,        // raw audio frame index
  featureRate: 1000,
  features: [
    { name: "700-1400", data: Float32Array },
    { name: "1400-2800", data: Float32Array },
    { name: "2800-5600", data: Float32Array },
    { name: "5600-10000", data: Float32Array },
    { name: "10000-16000", data: Float32Array }
  ]
}
```

### feature extraction in the worklet

The worklet should extract features, not decide final beats.

For each incoming audio sample:

1. Convert microphone input to mono.
2. Run the sample through a small bank of coarse bandpass filters.
3. For each band, compute tick-energy novelty:
   ```txt
   bandpassed sample
   -> abs()
   -> fast envelope, about 1-3 ms
   -> slow envelope, about 50-200 ms
   -> novelty = max(0, fast - slow)
   ```
4. Decimate novelty to `featureRate`.
5. Post feature batches every `50-100 ms`.

Initial frequency bands:

```txt
700-1400 Hz
1400-2800 Hz
2800-5600 Hz
5600-10000 Hz
10000-16000 Hz, only when audio sample rate supports it
```

Multiple bands are useful because watch ticks, microphones, and room noise vary.
Higher frequencies help reject some voice/traffic noise, but high-frequency
noise still exists. Folding is the main noise rejection step.

The worklet's time base is audio frames:

```js
rawTimeSeconds = absoluteRawFrame / sampleRate;
featureTimeSeconds = absoluteFeatureFrame / featureRate;
```

### standard fold algorithm

Current folding tests known standards at coarse phase resolution.

Inputs:
- Rolling feature buffers for the last `period` seconds.
- Candidate standards:
  `[14400, 18000, 19800, 21600, 25200, 28800, 36000]`.
- Phase bin count: default `128`.
- Fold cycle: default `2` beats, so one row shows the tick/tock cycle.

For each candidate standard:

```js
cycleBeats = 2;
T = (3600 / bph) * cycleBeats;
binCount = 128;

for each feature:
  folded[feature.name] = new Float32Array(binCount);

for each feature frame in the rolling period:
  t = featureFrame / featureRate;
  phase = (t % T) / T;
  bin = Math.floor(phase * binCount);

  for each feature:
    folded[feature.name][bin] += feature.data[featureFrame];
```

Normalize each folded row so older/louder recordings do not dominate:

```js
rowMean = mean(row);
rowStd = std(row);
normalizedBin = (rowBin - rowMean) / max(rowStd, epsilon);
```

Rows do not currently expose a public score. The heatmap is raw evidence:
if the watch signal is present, useful standards should show structured folded
energy and bad standards should look flatter or aliased.

### tracking direction

Do not build a separate hard standard-selection state first. Tracking should use
the standard folds for acquisition, then estimate actual BPH by fold fit.

Definitions:
- `nominalBph`: nearest known watch standard, for example `18000`.
- `actualBph`: the BPH estimate that makes the recent audio fold most cleanly.
  This is not a single detected tick timestamp. It is the best-fit period for
  the folded signal over the current lookback window.

The tracker should keep a high-resolution fold running at the current
`actualBph` estimate. Standard folds stay coarse and broad; the tracking fold is
fine and narrow.

Rough process:

```txt
standard folds
-> find a coarse candidate BPH
-> initialize actualBph from that candidate
-> build high-resolution 2-beat fold at actualBph
-> evaluate bphFitScore(actualBph)
-> evaluate nearby scores, for example actualBph +/- delta
-> move actualBph toward the better fit
-> rebuild the high-resolution fold at the updated actualBph
-> nominalBph = nearest known standard to actualBph
```

`bphFitScore` should reward a fold where tick/tock packet structure is sharp,
repeatable, and stable across bands / time chunks. It should penalize smeared
packets, unstable phase positions, and aliases that collapse tick/tock structure.

Use the 2-beat cycle for rate tracking because beat error affects adjacent
tick/tock spacing. The tracking fold should preserve both tick and tock packets
instead of forcing them into one beat interval.

Later:
- Convert to seconds/day:
  `(nominalInterval / actualInterval - 1) * 86400`.
- Estimate beat error from tick/tock asymmetry.
- Identify sub-events inside the tick packet for amplitude work.

### milestone 1: live fold heatmap

Purpose: prove that the browser is extracting useful live features and that
folding produces visible structure for real watch audio.

Build:
- `public/index.html`
- `public/data.js`
- `public/graph.js`
- `public/feature-worklet.js`
- `public/analysis-worker.js`

UI:
- Start/stop microphone button.
- Period control, default `10s`.
- Feature rate display.
- ECharts heatmap that updates in real time.

Heatmap layout:

```txt
rows:    standard + frequency band
columns: phase bins across the 2-beat tick/tock cycle
cells:   normalized folded intensity
```

Example rows:

```txt
14400 / 700-1400
14400 / 1400-2800
...
28800 / 5600-10000
...
36000 / 10000-16000
```

Expected result:
- With no watch, rows should look mostly flat/random.
- With a watch near the mic, the correct standard should show one or more
  stable bright regions in at least one frequency band.
- Incorrect standards may show weak aliases.

Worker output for milestone 1:

```js
{
  type: "analysis",
  periodSeconds: 10,
  featureRate: 1000,
  standardFolds: {
    binCount: 128,
    cycleBeats: 2,
    rows: [
      {
        bph: 28800,
        band: "5600-10000",
        bins: Float32Array
      }
    ]
  },
  tracking: null
}
```

Acceptance criteria:
- App runs from `public/index.html`.
- Microphone stream starts and stops cleanly.
- Worklet posts feature batches using audio-frame time.
- Worker keeps a rolling `period` buffer.
- Heatmap updates at least `5` times per second.
- A nearby ticking watch produces visibly non-flat folded rows.
- No rate graph yet. No beat timestamp extraction yet.

### lock-on details

Lock-on is later work. The likely path:
- Use the folded heatmap to find a coarse candidate standard and phase.
- Track expected tick/tock packet positions over time.
- Treat stable timing error + repeatable packet shape as locked.
- Treat weak packets, unstable phase, or sudden phase jumps as unlocked.

### true rate estimation

Later work after milestone 1:
- Convert phase drift into seconds/day.
- Add confidence based on phase stability, packet shape, and band agreement.
- Add a rate graph.

### period behavior

`period` is a duration in seconds, not a raw beat count. It controls how much
feature history is folded.

Suggested UI values:
- `2s`: fast response, noisy.
- `5s`: useful live-ish feedback.
- `10s`: good default.
- `20s` or `30s`: stable average.

Implementation:

```js
const framesToKeep = Math.ceil(periodSeconds * featureRate);
```

Worker update cadence can be independent of feature cadence. Recompute and send
analysis messages around `5-10` times per second.

### later measurements

Once basic rate works, add:

- Beat error: compare alternating beat intervals. A watch with uneven tick/tock
  spacing has alternating short/long intervals. Estimate:
  `beatErrorMs = abs(meanEvenInterval - meanOddInterval) * 500`.
- Amplitude: real timegraphers infer balance amplitude from lift angle and
  acoustic event spacing inside each tick. This is harder and should be later.
- Multiple microphones / channels: choose the channel with best confidence or
  combine after independent onset detection.
