# iPhone workout app — technical proposal

Status: draft for discussion; no application implementation yet.

## 1. Product idea

Turn Workout Ledger into an iPhone workout recorder, starting with outdoor cycling. The interface runs in a bundled WebKit view, with a small purpose-built Swift bridge to native recording, location, and Bluetooth. No Capacitor dependency.

The defining experience is **live laps and familiar segments**: while riding, see current speed, time, distance, heart rate, and how the current lap or segment compares with previous efforts. Recording and previously downloaded comparisons work offline.

### First usable release

- Start, manually pause/resume, finish, and save a cycling workout.
- Record GPS, speed, altitude, distance, and optional Bluetooth heart rate, including with the screen locked.
- Show elapsed/active time, distance, average/current speed, elevation gain, and heart rate.
- Record manual laps; automatically time laps on a selected known loop.
- Recognize known segments and show a live comparison against a historical effort.
- Keep completed and interrupted workouts locally; export to the existing analysis app.
- Import a versioned route/reference pack from the existing archive before riding.

Later: automatic discovery of new loops during a ride, running-specific layouts, auto-pause, cloud sync, HealthKit/Apple Watch, navigation, audio coaching, additional Bluetooth sensors, and FIT export. Manual laps make unfamiliar routes usable immediately.

## 2. Existing code and reuse

| Existing area | Proposed use |
| --- | --- |
| `src/domain/activity.ts` | Reuse units and normalized activity/sample concepts. Add a mobile recording model rather than force incomplete live samples into `WorkoutDetail`, whose coordinates are required. |
| `src/domain/analysis.ts` | Reuse segment/loop geometry and traversal concepts; add versioned mobile route packs and reference progress timelines. |
| `src/services/SegmentDetector.ts` | Keep archive-wide discovery in the desktop pipeline. Extract portable geometry helpers where useful; this module currently imports `node:crypto` and database types and is not a mobile runtime module. |
| `src/components/LoopRouteDetail.tsx` | Reuse lap/history presentation ideas and formatting, adapted to a glanceable phone interface. |
| `src/components/RouteThumbnail.tsx` and `RouteDetailShared.tsx` | Evaluate reusable geometry rendering/formatting after isolating web-only dependencies. Route lines should work without map tiles. |
| `src/server/*.functions.ts`, DuckDB, Garmin/FIT pipeline | Remain desktop/server concerns. Add import/export adapters at this boundary. |

The current app is React 19 + TanStack Start, built with Bun/Vite, with server functions and native Node DuckDB. It cannot simply be bundled as-is into WKWebView. Add a static mobile React entry with a native-backed data adapter; share pure types, formatting, and selected components. Keep the existing archive browser as the analysis companion.

Proposed future layout, subject to implementation-time adjustment:

```text
workout-analyze/
  ios/                       Swift app target, WKWebView, native services
  mobile/                    static React entry, screens, bridge client
  src/shared/                portable contracts, formatting, geometry
  src/...                    existing archive app and analysis pipeline
  docs/                      this proposal and wireframes
```

Use Bun + TypeScript for web development; shadcn/ui with Base UI, Tailwind, and Lucide for new mobile screens. Prefer functions/interfaces in TypeScript. Swift framework delegates can use conventional native classes.

## 3. Architecture and ownership

```text
Bundled React UI in WKWebView
         ⇅ versioned commands / snapshots / events
Swift bridge dispatcher
         ⇅
Native workout coordinator
  ├─ Core Location: timestamped location, speed, altitude, accuracy
  ├─ Core Bluetooth: standard BLE heart-rate monitor
  ├─ metrics + streaming route/lap matcher
  └─ SQLite: samples, state transitions, laps, route packs, summaries

Desktop archive ⇄ versioned files ⇄ native import/export
```

**Native is the source of truth.** It owns the session state machine, clocks, sensor collection, derived metrics, automatic lap/segment decisions, and durable writes. JavaScript renders snapshots and sends user commands. WKWebView timers and JavaScript execution are not dependable background services.

The live matcher therefore runs in Swift too. Reuse existing detection concepts and exported geometries, not an assumption that the TypeScript batch detector can run continuously in a backgrounded WebView. Shared fixture files will verify agreement between archive export and native matching.

Bundle assets into the app and serve them through a restricted local WKURLSchemeHandler with a defined app origin. Validate asset routing/module loading in the shell spike. No development server is required on a ride. External links open outside the privileged WebView; native commands are accepted only from the bundled main frame. The packaged UI and bridge ship together.

### iOS services

- **Core Location:** foreground-started workout location updates, appropriate fitness activity configuration, precise-location status, location background mode, and `allowsBackgroundLocationUpdates`. Choose accuracy/distance filtering through device testing; a roughly 1 Hz display is a goal, not a guaranteed sensor cadence.
- **Permissions:** explain location use at first workout start and Bluetooth use when pairing. Validate the least-privileged authorization supporting a foreground-started, lock-screen recording on supported iOS versions. Do not assume Always authorization is required; request escalation only if the chosen lifecycle actually needs it.
- **Core Bluetooth:** central role, Heart Rate service `0x180D`, measurement `0x2A37`; parse flags and 8/16-bit values. Remember the selected peripheral, reconnect, and expose connection/staleness state. Enable `bluetooth-central` background mode as needed and evaluate state restoration on device.
- **Elevation:** start with Core Location altitude plus vertical accuracy. Filter noise before accumulating ascent. Optional relative barometer input through Core Motion is a later improvement, not an absolute altitude replacement.
- **Storage:** native SQLite with migrations; serialize writes and session mutations. Samples and the corresponding durable sequence/checkpoint commit atomically in small batches. Acknowledge start/pause/finish only after their transitions persist.

Screen lock/backgrounding must not stop an active native recorder. Force-quit, OS termination, and reboot cannot be promised uninterrupted recording: preserve committed data, detect the interruption on reopening, mark a gap, and offer recovery. A crashed/reloaded WebView simply reconnects to the native session.

## 4. Bridge contract (outline)

Use WKScriptMessageHandler for validated JSON commands and a narrow native-to-JavaScript event receiver. Define payload schemas and a protocol version in shared documentation/types. Treat everything received through the bridge as input to validate; allowlisted methods only, bounded message sizes, and no generic native evaluation or filesystem access.

```ts
interface Command {
  protocolVersion: 1
  requestId: string
  method: string // closed union in implementation
  params: unknown // method-specific validated payload
}

interface NativeEvent {
  protocolVersion: 1
  sessionId: string | null
  sequence: number
  type: string
  payload: unknown
}
```

| Commands | Purpose |
| --- | --- |
| `bridge.hello`, `session.snapshot` | Negotiate version/capabilities; obtain authoritative state and latest sequence. |
| `permissions.status`, `permissions.request` | Explicit location/Bluetooth status and user-initiated prompts. |
| `workout.start/pause/resume/finish`, `lap.mark` | Idempotent mutations with request IDs and expected session/state revision. |
| `sensors.scan/connect/disconnect` | Discover and select a heart-rate monitor; bounded foreground scan. |
| `routes.list/select`, `reference.select` | Choose a loop, segment focus, or comparison reference. |
| `archive.list/detail`, `transfer.import/export` | Paginated local history and native file/share flows. |

Replies carry the request ID and either a typed result or a stable error code (`permissionDenied`, `invalidState`, `sensorUnavailable`, `storageFailure`, `unsupportedVersion`). A retry must not create a second workout or duplicate lap; retain mutation outcomes across bridge reconnections.

Events include `session.updated`, `metrics.updated`, `lap.completed`, `segment.updated`, `sensor.updated`, and `recording.issue`. Throttle display metrics to about once per second, coalesce superseded updates, and send transitions promptly. Persist raw data independently of event delivery.

On attach/resume: establish delivery, fetch an atomic snapshot with sequence, discard older queued events, then apply newer events. Detect a sequence gap and resnapshot; do not replay an unbounded ride into JavaScript. Paginate historical samples separately. Clock-based animation between snapshots is visual only.

## 5. Recording and metrics

State machine: `idle → recording ⇄ paused → finished`. An interrupted persisted session opens a recovery flow before recording can resume. Only one active session is allowed. Finishing saves locally first; sharing is a separate action. Discard requires an explicit action after stopping.

Store raw sensor observations separately from derived display values. Each observation includes session ID, sequence, source timestamp, receipt timestamp, nullable values, and quality/accuracy fields. Keep location and heart-rate streams independently timestamped rather than invent coordinates for an HR-only observation.

- Use monotonic time for active durations within a process lifetime and UTC for interchange. Persist pause/resume intervals and checkpoints; never count a reboot/unknown interruption as active riding time.
- Display **active time** prominently, and total elapsed time in details. Average speed is accepted distance divided by active time. No auto-pause in the first release.
- Distance accumulates from accepted location points while recording. Reject stale fixes, impossible jumps, and poor accuracy; do not draw or measure a straight line across a long gap or pause.
- Prefer valid reported speed; fall back to timestamped accepted-position deltas. Smooth the display, retain raw measurements, and show unknown/stale values as `—`, not zero.
- Apply vertical-accuracy filtering and a documented deadband before summing positive altitude changes. Label ascent as estimated; tune against real rides.
- HR includes last observation time and connection status. A disconnected monitor does not end the workout. Define and test a staleness threshold; never display an old reading as live.
- Pause stops active time/distance and invalidates an in-progress competitive comparison. Location may remain available for reacquisition; ignored observations are clearly marked.
- Handle out-of-order/batched locations by measurement time and deduplicate observations before derivation.

Records: `WorkoutSession`, `LocationObservation`, `HeartRateObservation`, `SessionTransition`, `Lap`, `SegmentAttempt`, `RoutePack`, and `ReferenceEffort`. Derived records carry algorithm/route versions so later analysis can be distinguished from the live result. Laps and attempts retain incomplete/invalid status and reason.

## 6. Laps and segments

### Known loops and automatic laps

Choose a known loop before starting, or accept a confident suggestion during the ride. For the initial version, explicit loop selection takes priority over automatic segment presentation.

1. Match accepted positions to the loop centerline with direction and progress continuity, not nearest point alone.
2. Arm a directional start/finish gate after a confident approach. If starting halfway around a loop, show “approaching lap start”; the partial first circuit is not a completed lap.
3. Start the lap on a valid gate crossing. Interpolate crossing time between reliable samples.
4. Complete it only after sufficient route coverage/progress and a valid return crossing. Use minimum travel/time and gate hysteresis to prevent GPS jitter generating laps.
5. Start the next lap immediately; show current lap time, previous lap, best completed lap, and the full completed-lap list.

Manual laps work anywhere and are labeled separately. In automatic-loop mode a manual split does not reset the automatic gate tracker. A mid-lap finish remains partial. Wrong direction, skipped route, pause, or a location gap that makes the finish ambiguous prevents a falsely precise valid lap.

Track-sized loops need tighter, separately tuned live thresholds: the archive detector's 40 m resampling / 30 m deviation defaults are not automatically appropriate for a 400 m track or adjacent lanes. Use original sample detail where available, accuracy-aware matching, and physical testing. GPS alone cannot promise lane-level track timing.

### Segment selection and “longest previous segment”

Working interpretation: **prefer the longest previously discovered segment consistent with the current ride**, then compare against a previous traversal of that same segment. This is distinct from selecting the slowest/longest-duration historical effort.

- Candidate state: `nearby → armed → active → completed`, or `abandoned/uncertain`.
- Filter by sport, proximity, direction, start-gate crossing, and sustained progress.
- Among eligible overlapping candidates, prefer the longest confidently matching route. Freeze the displayed candidate once active to avoid card flicker; candidate tracking may continue internally.
- At an ambiguous fork, keep the established candidate or show “matching route” until confidence improves. Entering halfway produces a partial attempt, not a full-segment comparison.
- If the route is lost, suppress the live delta and retain an incomplete attempt. Reacquisition must not silently bridge an ambiguous gap.
- User-selected loop mode owns the large card; a segment can appear as a secondary indicator without replacing lap controls.

### Historical comparison

Default proposal: compare segments with the **most recent valid complete effort** in the same direction; allow best effort as a pre-ride choice. For laps, default to the previous completed lap this session, then a historical loop reference if none exists. Always name the baseline.

Export a monotonic `distanceAlongRouteM → elapsedSeconds` timeline for each reference. Existing `RouteTraversal` summaries have total durations and lap times but not this full timeline: the desktop exporter must reconstruct it from timestamped samples and matched boundaries. Missing/invalid timings make that effort ineligible for a live delta.

At current matched progress `s`, interpolate the reference time at `s`:

`deltaSeconds = currentAttemptElapsedSeconds - referenceElapsedSeconds(s)`

Negative means ahead; positive means behind. Show words as well as signs/color, e.g. “4 s ahead of last ride.” Compare equal route progress, not equal wall-clock time or raw traveled distance. Suppress deltas for uncertain matching, reversals, pauses, or incompatible route revisions. Reference comparisons use elapsed effort time and exclude paused historical attempts in the first version.

## 7. Offline data and archive integration

Start with explicit files rather than requiring accounts or a server:

1. Desktop exports a versioned route pack: route geometry, direction, gates, sport, source analysis revision, reference IDs, and progress/time timelines.
2. iPhone imports through the native document picker, validates schema/checksums, and stores the pack locally. Pin the pack revision for the duration of a workout.
3. iPhone exports a versioned workout bundle containing metadata, raw streams, transitions, lap/attempt records, and algorithm versions through the share sheet. GPX can be an additional convenience export; it is not the lossless source format.
4. A new desktop importer assigns stable `iphone:<UUID>` activity IDs, deduplicates repeat imports, and maps samples into the normalized pipeline. It must not put files in the Garmin-specific raw source directory.
5. Existing analysis can rediscover routes and compare phone/Garmin workouts. Preserve native lap events alongside recomputed analysis so users can distinguish the two.

Nothing requires mobile DuckDB or Garmin credentials. Native samples remain saved if export fails. The route line and progress view work offline; downloaded map tiles are not part of the first release.

## 8. UI proposal

See [the editable Excalidraw scene](iphone-workout-wireframes.excalidraw) and [its PNG preview](iphone-workout-wireframes.preview.svg.png). Values are illustrative; the Live, Laps, and Segment panels depict alternative foreground states, not a single synchronized ride.

| Screen/state | Main content and controls |
| --- | --- |
| Ready | Cycling, GPS readiness, HR status, selected loop/reference, large Start button, recent saved ride. |
| Live / Ride | Very large current speed; active time/distance; average speed/HR; altitude/ascent; stable sensor status; Lap and Pause. |
| Live / Laps | Current lap number/time/speed; previous/best lap; scrollable completed times; global workout time/distance/HR remain visible. |
| Live / Segment | Segment name, progress, large ahead/behind delta with named baseline, current/reference time at this point; global stats and controls. |
| Paused | Frozen totals; prominent Resume; Finish & save; optional discard behind an explicit secondary confirmation. |
| Saved | Summary, route thumbnail, laps/segments, local-save state, Export, Done. |

Sensor connection is a sheet reachable from Ready or the status strip: scan, device list, selected device, live HR, connection state, disconnect. Route/reference choice is another pre-ride sheet. Recovery after interruption shows saved duration, last recording time, the known gap, and Resume or Finish saved workout.

Interaction rules:

- Portrait-first, safe-area-aware, high contrast, large numerals, 48–56 pt primary touch targets, clear units, and no color-only meaning.
- Persistent Ride/Laps/Segment selector; automatic recognition updates a context card but does not unexpectedly navigate away from a deliberately selected screen.
- Prefer sparse stable layouts over a map as the main riding screen. Full lap history is available by scrolling; current metrics and controls remain fixed.
- Optional keep-screen-awake while recording; restore normal behavior on pause/finish. Locked-screen recording is still supported.
- Poor GPS, HR disconnected, and recording/storage failure are distinct states. Poor GPS suppresses uncertain values; storage failure requires a persistent actionable recording error rather than continuing to imply data is saved.
- Keep Start available without HR. Before a GPS fix, offer an explicit “start waiting for GPS” state; elapsed time may run, but distance is unknown until reliable acquisition.

## 9. Implementation slices and acceptance gates

These are future bounded handoff units, not work being delegated now. Each implementation handoff should include this spec, exact owned paths, the frozen contract/fixtures it depends on, its acceptance gate, and unresolved decisions.

| Slice | Deliverable | Acceptance gate / dependency |
| --- | --- | --- |
| 1. Contracts + shell spike | Static mobile entry, WKWebView host, versioned bridge, simulator adapter, basic screen. | Bundled app launches offline on a real phone; round trip and WebView reload recovery work. Freeze contracts before dependent slices. |
| 2. Native recorder | Core Location, storage, clocks, state machine, metrics, interruption recovery. | Real outdoor ride with screen lock, backgrounding, pauses, and relaunch; committed samples and correct totals survive. Depends on 1. |
| 3. Mobile screens | Ready/Live/Laps/Segment/Paused/Saved, fixture-driven first. | Readable on a mounted phone; all transitions/errors represented. Can proceed against slice 1's simulator while 2 is built. |
| 4. BLE heart rate | Scan/pair/reconnect, native measurements and status events. | Real standard HR strap tested in foreground/background and after disconnect. Depends on 1–2 contracts. |
| 5. Route packs + archive import | Export reference timelines; file transfer; phone workout importer. | Offline pack import and phone→archive round trip without duplicate activities or unit loss. Contract work can overlap 2–4. |
| 6. Live loop matcher | Swift gate/progress matcher, automatic laps, manual-split coexistence. | Replay fixtures and physical loop tests cover jitter, mid-loop start, reverse travel, pauses, and missing fixes. Depends on 2 and 5. |
| 7. Segment comparison | Candidate ranking, stable selection, progress delta. | Known-route replay agrees with expected crossings/reference times; forks and gaps suppress misleading deltas. Depends on 5–6 geometry foundations. |
| 8. Integrated ride validation | Full ride, export, analysis, recovery, battery observations. | Signed install works without development server; all previous gates pass together. |

Keep an initial milestone of **recording + manual laps + saved export** before automatic matching. It is already useful on the bike and validates the difficult iOS lifecycle assumptions early.

Testing emphasis: deterministic location/HR replay with golden lap/segment boundaries; native lifecycle/storage integration; bridge duplicate/gap/version cases; real iPhone outdoor GPS and real BLE hardware. Simulator GPS does not establish background reliability or real timing accuracy. Measure battery use, sensor cadence, matcher ambiguity, lap timing error, and foreground reconnect time before choosing performance targets.

## 10. Decisions to confirm

1. Does “longest previous segment” mean longest matching route geometry, as assumed here?
2. Historical default: last valid effort (proposed), personal best, or selectable before every ride?
3. Is selecting a known loop sufficient initially, with manual laps on new routes, or must first-ride automatic loop discovery be in v1?
4. Phone mounted with screen mostly on, or mostly locked/in a pocket? Both record, but this determines UI/battery priorities.
5. Which iPhone/iOS minimum and which HR monitor should be the first physical test targets? Cycling first; running follows with pace-oriented UI.
6. Is manual route-pack/workout file exchange acceptable initially? Recommendation: yes, then add convenient sync after the recording path is solid.

Recommended next step: review the screen hierarchy and these defaults, then implement the small native recording/bridge spike before investing in live matching.
