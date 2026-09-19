# iPhone workout app — technical proposal

Status: draft for discussion; no application implementation yet.

## 1. Product idea

Turn Workout Ledger into an iPhone workout recorder, starting with outdoor cycling. The interface runs in a bundled WebKit view, with a small purpose-built Swift bridge to native recording, location, and Bluetooth. No Capacitor dependency.

The defining experience is **live laps and familiar segments**: while riding, see current speed, time, distance, heart rate, and how the current lap or segment compares with previous efforts. Recording and previously downloaded comparisons work offline.

**Start and ride:** no loop, segment, direction, or reference selection is required. Native matching uses location and a sequence of movement observations to recognize known routes automatically. Home also provides access to previous workouts and segment/loop analysis, bringing the existing archive-browsing experience onto the phone.

### Terminology and relationship to existing analysis

- **Segment:** a route geometry identified by workout analysis, with historical traversals.
- **Loop:** a repeatable circuit identified by that analysis—a segment ridden around repeatedly.
- **Lap:** one iteration/traversal of a loop, belonging to that loop and workout. Lap boundaries and times are inferred from the recorded movement.

The existing code represents route kinds as `segment | loop`; keep that distinction in data contracts while treating both as analyzed routes in the product. Live recognition locates the rider on these routes and identifies successive laps of a recognized loop. There is no user-created lap, manual split, lap-marking command, or lap button. Outside a recognized loop the app records the workout and any recognized segment attempts without inventing laps. Previously unknown routes can be analyzed after recording; discovering them during recording remains a separate scope decision.

### First usable release

- Start, manually pause/resume, finish, and save a cycling workout.
- Record GPS, speed, altitude, distance, and optional Bluetooth heart rate, including with the screen locked.
- Show elapsed/active time, distance, average/current speed, elevation gain, and heart rate.
- Show a live geographic map with rider location, recorded trail, and highlighted recognized loop/segment; adapt the camera to route size and rider progress.
- Automatically recognize analyzed loops and time each successive lap of the recognized loop.
- Recognize known segments and show a live comparison against a historical effort.
- Keep completed and interrupted workouts locally; export to the existing analysis app.
- Import a versioned route/reference pack from the existing archive before riding.
- Browse previous workouts and segment/loop analysis through dedicated list and detail pages.

Later: automatic discovery of new loops during a ride, running-specific layouts, auto-pause, cloud sync, HealthKit/Apple Watch, navigation, audio coaching, additional Bluetooth sensors, and FIT export. Unfamiliar routes are still recorded normally and can be analyzed afterward.

## 2. Existing code and reuse

| Existing area | Proposed use |
| --- | --- |
| `src/domain/activity.ts` | Reuse units and normalized activity/sample concepts. Add a mobile recording model rather than force incomplete live samples into `WorkoutDetail`, whose coordinates are required. |
| `src/domain/analysis.ts` | Reuse segment/loop geometry and traversal concepts; add versioned mobile route packs and reference progress timelines. |
| `src/services/SegmentDetector.ts` | Keep archive-wide discovery in the desktop pipeline. Extract portable geometry helpers where useful; this module currently imports `node:crypto` and database types and is not a mobile runtime module. |
| `src/components/LoopRouteDetail.tsx` | Reuse lap/history presentation ideas and formatting, adapted to a glanceable phone interface. |
| `src/components/RouteThumbnail.tsx` and `RouteDetailShared.tsx` | Reuse route styling, geometry, and formatting ideas after isolating web-only dependencies. Add an interactive live map renderer; a route thumbnail alone is insufficient. |
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
| `workout.start/pause/resume/finish` | Idempotent mutations with request IDs and expected session/state revision. Laps are native analysis outputs, not commands. |
| `sensors.scan/connect/disconnect` | Discover and select a heart-rate monitor; bounded foreground scan. |
| `routes.list/detail`, `reference.preference` | Browse segment/loop analysis and optionally change the saved comparison preference. Recognition requires no selection command. |
| `archive.list/detail`, `transfer.import/export` | Paginated local history and native file/share flows. |

Replies carry the request ID and either a typed result or a stable error code (`permissionDenied`, `invalidState`, `sensorUnavailable`, `storageFailure`, `unsupportedVersion`). A retry must not create a second workout or repeat a state transition; retain mutation outcomes across bridge reconnections. Derived lap events have stable IDs so reconnecting cannot duplicate a displayed lap.

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

After Start Ride, automatically query nearby known loops and segments from the local route catalog. Rank candidates using location accuracy, direction of travel, and sustained progress over multiple samples. Course is unreliable when stationary: wait for movement rather than requiring the rider to identify the route. Recognition and lap timing never require a confirmation tap.

Recognizing where the rider is and starting a valid timed effort are separate decisions. The app can recognize a loop or segment halfway along it and show position/context immediately; a full comparable effort still needs an observed start boundary. Retain recent accepted observations so delayed recognition can recover a start crossing already recorded with sufficient confidence, rather than lose that effort just because classification took a few seconds. Never invent an unobserved start.

1. Automatically identify the loop and match accepted positions to its centerline with direction and progress continuity, not nearest point alone.
2. Arm a directional start/finish gate after a confident approach. If starting halfway around a loop, show “approaching lap start”; the partial first circuit is not a completed lap.
3. Start the lap on a valid gate crossing. Interpolate crossing time between reliable samples.
4. Complete it only after sufficient route coverage/progress and a valid return crossing. Use minimum travel/time and gate hysteresis to prevent GPS jitter generating laps.
5. Start the next lap immediately; show current lap time, previous lap, best completed lap, and the full completed-lap list.

Every lap belongs to a detected loop and is inferred automatically. A mid-lap finish remains partial. Wrong direction, skipped route, pause, or a location gap that makes the finish ambiguous prevents a falsely precise valid lap. Start/finish gates are algorithmic boundaries derived from the loop geometry, not controls that the rider sets or triggers.

Track-sized loops need tighter, separately tuned live thresholds: the archive detector's 40 m resampling / 30 m deviation defaults are not automatically appropriate for a 400 m track or adjacent lanes. Use original sample detail where available, accuracy-aware matching, and physical testing. GPS alone cannot promise lane-level track timing.

### Segment selection and “longest previous segment”

Working interpretation: **prefer the longest previously discovered segment consistent with the current ride**, then compare against a previous traversal of that same segment. This is distinct from selecting the slowest/longest-duration historical effort.

- Candidate state: `nearby → armed → active → completed`, or `abandoned/uncertain`.
- Recognize route context by sport, proximity, direction, and sustained progress; require a reliably observed start-gate crossing only for a complete timed attempt.
- Among eligible overlapping candidates, prefer the longest confidently matching route. Freeze the displayed candidate once active to avoid card flicker; candidate tracking may continue internally.
- At an ambiguous fork, keep the established candidate or show “matching route” until confidence improves. Entering halfway produces a partial attempt, not a full-segment comparison.
- If the route is lost, suppress the live delta and retain an incomplete attempt. Reacquisition must not silently bridge an ambiguous gap.
- A confidently recognized active loop gives laps priority in the automatic context card; overlapping segments may be tracked and shown secondarily. Keep that context stable until completion or sustained evidence of departure, then resume automatic discovery. On a non-loop route, the matching segment owns the card. Recognition must not require switching a mode.

### Historical comparison

Default proposal: compare segments with the **most recent valid complete effort** in the same direction; optionally change the saved default to best effort in settings/analysis. Starting a ride never requires choosing a reference. For laps, default to the previous completed lap this session, then a historical loop reference if none exists. Always name the baseline.

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

For mobile browsing, also support an archive snapshot containing workout summaries, route thumbnails, segment/loop summaries, historical traversals/lap times, and trends. Full workout samples can be included for imported detail views. Route packs alone are sufficient for live recognition but do not imply that the whole workout archive is on the phone. List/detail APIs expose data availability; show which history is downloaded and offer import from the library, without putting an import step in the Start Ride flow. Phone-recorded workout details are immediately available locally. Initially reuse precomputed analysis results; archive-wide detection/rebuild remains in the companion pipeline.

Nothing requires mobile DuckDB or Garmin credentials. Native samples remain saved if export fails. The route line and progress view work offline; downloaded map tiles are not part of the first release.

The first release includes a geographic basemap when available, plus a usable offline route/location overlay. Choose a map provider/renderer and validate WKWebView support, attribution, tile licensing, caching policy, and network behavior in the shell spike. Bundled route geometry is not an offline basemap: when tiles are unavailable, clearly indicate that the basemap is unavailable while continuing to show the rider, trail, highlighted route, and scale. Full downloadable offline basemaps remain a separate scope decision.

## 8. UI proposal

See [the editable Excalidraw scene](iphone-workout-wireframes.excalidraw) and [its PNG preview](iphone-workout-wireframes.preview.svg.png). Values are illustrative; the Live, Laps, and Segment panels depict alternative foreground states, not a single synchronized ride.

The detailed screens form a **wireflow**: arrows run directly from actual buttons to the actual destination views. Screens are spaced around Home and Live to leave routing corridors; there is no separate navigation diagram or duplicate screen representation. Blue arrows show primary forward transitions and dashed arrows show returns. Back navigation returns to the browsing parent, and Return to ride restores the active workout. Shared tab behavior, supporting sheets, and history cross-links are described in notes rather than drawing every repeated transition.

| Screen/state | Main content and controls |
| --- | --- |
| Home | Links to Previous workouts and Segment analysis, recent ride, compact GPS/HR status, and a large Start Ride button pinned at the bottom above the safe area. No route setup form. |
| Workouts → Workout detail | Chronological history, sport/date filters, time/distance summaries; detail has route, stats, sample charts when downloaded, laps, and matched segments linking to analysis. |
| Segment analysis → Segment/loop detail | Browse known segments and loops with thumbnails and workout counts; detail shows route, historical efforts, lap breakdowns, and trends, with links back to source workouts. |
| Live / Ride | Live map with rider and highlighted recognized route; large current speed; active time/distance; average speed/HR; altitude/ascent; stable sensor status; full-width Pause control. |
| Live / Laps | Map of recognized loop and rider progress; current lap number/time/speed; previous/best lap; scrollable completed times; global workout time/distance/HR remain visible. |
| Live / Segment | Map highlighting the segment and rider; segment name, progress, ahead/behind delta with named baseline, current/reference time at this point; global stats and controls. |
| Paused | Frozen totals; prominent Resume; Finish & save; optional discard behind an explicit secondary confirmation. |
| Saved | Summary, route thumbnail, laps/segments, local-save state, Export, Done. |

Sensor connection is a sheet reachable from Home or the status strip: scan, device list, selected device, live HR, connection state, disconnect. Library/settings holds archive import and optional reference defaults; browsing a route does not select it for the next ride. Recovery after interruption shows saved duration, last recording time, the known gap, and Resume or Finish saved workout.

Navigation: Home → Workouts → Workout detail, or Home → Segment analysis → Segment/loop detail. Back returns through the browsing stack. Start Ride opens Live directly using saved defaults; the primary Ride page automatically surfaces recognized loop/segment context. If the user browses history during recording, a persistent “Return to ride” control replaces Start Ride and leads back to the same native session.

Interaction rules:

- Portrait-first, safe-area-aware, high contrast, large numerals, 48–56 pt primary touch targets, clear units, and no color-only meaning.
- Persistent Ride/Laps/Segment selector; automatic recognition updates a context card but does not unexpectedly navigate away from a deliberately selected screen.
- With no confident known-route match, show ordinary live stats and “Looking for known routes”; ambiguous matches resolve automatically as movement provides evidence. With no local catalog, recording still starts normally and shows that route history is unavailable. Automatic recognition of known routes is required; discovering a previously unknown loop is a separate future capability.
- Make the map a first-class part of all live tabs, balanced with large stable metrics. Full lap history is available by scrolling its own panel; map, current metrics, and controls remain visible. Offer map expansion for detail without making it a required interaction.
- Optional keep-screen-awake while recording; restore normal behavior on pause/finish. Locked-screen recording is still supported.
- Poor GPS, HR disconnected, and recording/storage failure are distinct states. Poor GPS suppresses uncertain values; storage failure requires a persistent actionable recording error rather than continuing to imply data is saved.
- Keep Start available without HR. Before a GPS fix, offer an explicit “start waiting for GPS” state; elapsed time may run, but distance is unknown until reliable acquisition.

### Map content and adaptive camera

- **Layers:** geographic basemap, subdued recorded trail, strongly highlighted active segment/loop, start/finish markers, and an unmistakable current-location marker with accuracy indication. Distinguish traveled/upcoming route portions without relying only on color. Use the accepted GPS position for the rider; matching supplies route progress rather than silently moving the GPS marker onto a centerline.
- **Default live camera — Auto:** initially follow the rider. Once a known route is confidently recognized, fit the rider and whole route only if it fits within a useful riding-scale zoom and leaves the marker visible inside the unobscured viewport. This commonly suits short loops.
- **Long routes:** cap automatic zoom-out. Follow the rider and a bounded upcoming section of the highlighted route, retaining some context behind. Do not fit a huge segment just because it became active. Use route progress/look-ahead rather than compass heading alone, especially at slow speed or on switchbacks.
- **Stability:** add padding for map controls/safe areas, smoothly update position, and use zoom hysteresis so the camera does not alternate between whole-route and local views every sample. North-up initially; rotation can be a later preference. Tune zoom bounds and look-ahead distances with real rides rather than promising fixed values here.
- **Controls:** `Fit route` explicitly frames the full active route even when it is long; `Follow me` restores automatic rider-aware framing. Panning/zooming enters a manual camera state and reveals the restore control. Do not immediately override the user's gesture. Expand opens a larger map with the same overlays and camera state; collapsing preserves that state.
- **Recognition changes:** update the highlighted geometry after sustained confidence; avoid sudden repeated refits on overlapping candidates. An uncertain/lost match is visibly marked and the map follows actual location; recorded trail and ordinary metrics continue.
- **Analysis detail:** opening a segment or loop from history initially fits that route with padding. Historical traversal selection can overlay its trace. This is route-centric browsing, separate from the rider-aware camera during a workout; the rider's distant location must not zoom the detail map out.
- **Poor GPS:** expose uncertainty/staleness and do not animate fabricated motion. Without a fix, frame the available route/history or show location acquisition status.

Map rendering and camera animation belong to the web UI; native snapshots provide position/accuracy, active route geometry/version, matched progress/confidence, and trail samples. Keep map-provider calls out of the recording pipeline. Use bounded/downsampled trail data for rendering so a long ride does not flood the bridge or map.

## 9. Implementation slices and acceptance gates

These are future bounded handoff units, not work being delegated now. Each implementation handoff should include this spec, exact owned paths, the frozen contract/fixtures it depends on, its acceptance gate, and unresolved decisions.

| Slice | Deliverable | Acceptance gate / dependency |
| --- | --- | --- |
| 1. Contracts + shell spike | Static mobile entry, WKWebView host, versioned bridge, simulator adapter, map-renderer/provider spike. | Bundled app launches offline on a real phone; round trip and WebView reload recovery work; map overlays render and missing tiles degrade gracefully. Freeze contracts before dependent slices. |
| 2. Native recorder | Core Location, storage, clocks, state machine, metrics, interruption recovery. | Real outdoor ride with screen lock, backgrounding, pauses, and relaunch; committed samples and correct totals survive. Depends on 1. |
| 3. Mobile screens | Home, workout/analysis list and detail pages, Live/Laps/Segment/Paused/Saved, fixture-driven first. | Start pinned at bottom; no route setup; history drilldowns and return-to-ride work. Readable on a mounted phone; all transitions/errors represented. Can proceed against slice 1's simulator while 2 is built. |
| 3a. Live and analysis maps | Basemap/route/location layers, adaptive camera, fit/follow/manual states, expanded map. | Short-loop and long-segment fixtures keep rider visible without excessive zoom-out; gestures remain respected; route detail initially fits its route; offline/GPS-loss states work. Depends on 1 and 3 contracts; can precede real matcher with fixtures. |
| 4. BLE heart rate | Scan/pair/reconnect, native measurements and status events. | Real standard HR strap tested in foreground/background and after disconnect. Depends on 1–2 contracts. |
| 5. Route packs + archive import | Export reference timelines and browsable archive snapshots; file transfer; phone workout importer. | Offline recognition data and history/detail views; phone→archive round trip without duplicate activities or unit loss. Contract work can overlap 2–4. |
| 6. Live loop matcher | Automatic nearby-route recognition, Swift gate/progress matcher, successive lap identification tied to the detected loop. | Start with no route input; replay/device tests cover stationary start, overlapping candidates, delayed recognition, jitter, mid-loop start, reverse travel, departure/re-entry, pauses, and missing fixes. Depends on 2 and 5. |
| 7. Segment comparison | Candidate ranking, stable selection, progress delta. | Known-route replay agrees with expected crossings/reference times; forks and gaps suppress misleading deltas. Depends on 5–6 geometry foundations. |
| 8. Integrated ride validation | Full ride, export, analysis, recovery, battery observations. | Signed install works without development server; all previous gates pass together. |

Keep an engineering milestone of **recording + saved export** before automatic matching to validate iOS lifecycle assumptions early. The proposed first product release requires zero-setup recognition of known loops and segments, with laps derived automatically from loop traversals.

Testing emphasis: deterministic location/HR replay with golden lap/segment boundaries; native lifecycle/storage integration; bridge duplicate/gap/version cases; real iPhone outdoor GPS and real BLE hardware. Simulator GPS does not establish background reliability or real timing accuracy. Measure battery use, sensor cadence, matcher ambiguity, lap timing error, and foreground reconnect time before choosing performance targets.

## 10. Decisions to confirm

1. Does “longest previous segment” mean longest matching route geometry, as assumed here?
2. Historical default: last valid effort (proposed) or personal best? Either is automatic, with an optional saved preference.
3. Automatic recognition of known loops/segments is confirmed. Should discovering entirely new loops during a first ride also be in v1, or remain later as proposed?
4. Phone mounted with screen mostly on, or mostly locked/in a pocket? Both record, but this determines UI/battery priorities.
5. Which iPhone/iOS minimum and which HR monitor should be the first physical test targets? Cycling first; running follows with pace-oriented UI.
6. Is manual route-pack/workout file exchange acceptable initially? Recommendation: yes, then add convenient sync after the recording path is solid.
7. Which basemap provider should we use, and are fully downloaded offline basemaps required in v1? Live maps and route-focused analysis maps are confirmed; offline overlay-only fallback is the initial proposal.

Recommended next step: review the screen hierarchy and these defaults, then implement the small native recording/bridge spike before investing in live matching.
