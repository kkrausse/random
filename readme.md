# timegrapher

## how this works (human only)

pipeline
- use sound frequency filter for specific range to reduce noise 
- extract envelope
- auto detect standard (eg [14400, 18000, 19800, 21600, 25200, 28800, 36000])
- feature extraction (extract the lock / unlock points?)
  - "true rate" estimation

## code / detail architecture

### impl details of pipeline

This app is live browser recording only. There is no file import path in the
initial design.

Core idea:
- Use the audio stream sample count as the clock. Do not use `performance.now()`
  for measurement.
- Extract low-rate tick-energy features from the microphone stream.
- Fold those features against known watch standards.
- Use the folded energy pattern to detect the likely standard and later track
  phase drift / true rate.

Terms:
- `BPH`: beats per hour. Common standards: `14400`, `18000`, `19800`, `21600`,
  `25200`, `28800`, `36000`.
- `nominalInterval`: expected seconds between beats, `3600 / BPH`.
- `featureRate`: sample rate of the extracted feature stream, not the raw audio
  sample rate. First target: `1000 Hz`; use `2000 Hz` if timing looks too coarse.
- `period`: user-selected lookback duration, in seconds, used for folding and
  later rate estimation.

Initial file layout:

```txt
public/
  index.html
  data.js
  graph.js
  feature-worklet.js
  analysis-worker.js
```

`index.html`:
- Requests microphone access.
- Creates the `AudioContext`, loads `feature-worklet.js`, and starts/stops the
  stream.
- Creates `analysis-worker.js`.
- Owns UI controls: period, sensitivity/debug controls, start/stop.
- Displays the current standard score table / heatmap.

`data.js`:
- Defines shared constants and message schemas.
- Holds pure analysis helpers that can also be imported by
  `analysis-worker.js` if useful.
- Does not touch the DOM.

`graph.js`:
- Owns display only.
- First milestone should use Apache ECharts for the heatmap.
- Input is processed worker output, not raw audio.

`feature-worklet.js`:
- Runs inside an `AudioWorkletProcessor`.
- Receives raw microphone PCM.
- Maintains an absolute raw audio frame counter.
- Produces coarse frequency-band novelty features at `featureRate`.
- Posts feature batches to the main thread.

`analysis-worker.js`:
- Receives feature batches from the main thread.
- Maintains rolling feature buffers.
- Runs folding for all candidate standards.
- Posts fold tables, scores, and later rate estimates back to the main thread.

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
  featureRate: 1000,
  features: [
    { name: "700-1400", data: Float32Array },
    { name: "1400-2800", data: Float32Array },
    { name: "2800-5600", data: Float32Array },
    { name: "5600-10000", data: Float32Array }
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

### simple folding algorithm

First version should only test known standards at coarse phase resolution.

Inputs:
- Rolling feature buffers for the last `period` seconds.
- Candidate standards:
  `[14400, 18000, 19800, 21600, 25200, 28800, 36000]`.
- Phase bin count: start with `64` or `128`.

For each candidate standard:

```js
T = 3600 / bph;
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

Coarse score for one standard/band row:

```js
peak = max(normalizedRow);
background = median(normalizedRow);
contrast = peak - background;
score = contrast;
```

Coarse score for one standard:

```js
standardScore = max(score for all bands);
```

This intentionally keeps the first algorithm dumb. If the watch signal is
present, the correct standard should show a brighter, more structured folded
row than incorrect standards.

Later scoring improvements:
- Reward multiple adjacent bins forming a stable tick packet.
- Compare fold results across multiple time chunks inside `period`.
- Weight bands that consistently fold well.
- Add a fine search around the winning standard to estimate true rate.

### true rate direction

After standard detection works, estimate true rate by phase drift:

1. Pick the winning nominal standard.
2. Fold shorter rolling windows at that nominal interval.
3. Find the dominant phase/template position in each window.
4. Track phase movement over time.
5. Convert phase drift into rate error.

If phase moves earlier over time, the watch is running fast. If phase moves
later, the watch is running slow.

Alternative later implementation:
- Extract beat timestamps from the folded/template signal.
- Fit `beatTime = offset + actualInterval * beatIndex`.
- Convert to seconds/day:
  `(nominalInterval / actualInterval - 1) * 86400`.

Do not start here. First make the folding features visible and trustworthy.

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
columns: phase bins across one beat interval
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
- Incorrect standards may show weak aliases, but should score worse.

Worker output for milestone 1:

```js
{
  type: "folds",
  periodSeconds: 10,
  featureRate: 1000,
  binCount: 128,
  rows: [
    {
      bph: 28800,
      band: "5600-10000",
      score: 4.2,
      bins: Float32Array
    }
  ],
  best: {
    bph: 28800,
    band: "5600-10000",
    score: 4.2
  }
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

### standard detection details

Milestone 1 only reports scores. It does not need to make a hard final
standard decision.

Later, accept a detected standard only when:
- The best score is above an empirical threshold.
- The best score beats the second-best score by a clear margin.
- The winning standard stays stable across several updates.

The UI should still allow manual standard override.

### lock-on details

Lock-on is later work. The likely path:
- Use the folded heatmap to find the dominant phase/template for the selected
  standard.
- Track that phase over time.
- Treat high score + stable phase as locked.
- Treat low score, unstable phase, or sudden phase jumps as unlocked.

### true rate estimation

Later work after milestone 1:
- Convert phase drift into seconds/day.
- Add confidence based on fold score, phase stability, and band agreement.
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
folds around `5-10` times per second.

### later measurements

Once basic rate works, add:

- Beat error: compare alternating beat intervals. A watch with uneven tick/tock
  spacing has alternating short/long intervals. Estimate:
  `beatErrorMs = abs(meanEvenInterval - meanOddInterval) * 500`.
- Amplitude: real timegraphers infer balance amplitude from lift angle and
  acoustic event spacing inside each tick. This is harder and should be later.
- Multiple microphones / channels: choose the channel with best confidence or
  combine after independent onset detection.
