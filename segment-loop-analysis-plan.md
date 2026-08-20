# Segment + Loop Detection and Analysis UI

## Scope

Assume workout data is already normalized and queryable. This work only covers:

- automatic repeated **segment detection**
- automatic repeated **loop detection**
- canonical route geometry for each detected route
- extracting comparable traversals from prior workouts
- route-level quality/popularity ranking
- a **segment detail UI**
- a **loop detail UI**
- minor manual route adjustment, especially trimming segment edges

Performance modeling, weather correction, Garmin sync, and normalization are out of scope here.

---

## 1. Core Output Objects

Detection should produce two high-level route types:

```ts
type DetectedRoute = {
  id: string
  type: "segment" | "loop"

  geometry: Polyline
  distanceM: number

  workoutCount: number
  traversalCount: number

  matchScore: number
  popularityScore: number
  overallScore: number
}
```

Each route then has extracted traversals:

```ts
type RouteTraversal = {
  routeId: string
  activityId: string

  startedAt: Date
  endedAt: Date

  durationSec: number
  distanceM: number

  avgHeartRate?: number
  avgSpeed?: number

  matchErrorM: number
  qualityScore: number
}
```

For loops:

```ts
type LoopTraversal = RouteTraversal & {
  lapCount: number
  lapTimesSec: number[]
}
```

The exact persisted schema can follow the existing data model; these are conceptual outputs only.

---

# 2. Repeated Path / Segment Detection

## Goal

Find stretches of physical path that appear repeatedly across workouts, even when the complete workouts differ.

Example:

```text
Workout A: ------XXXXXXXXXXXX--------
Workout B: ---XXXXXXXXXXXX-----------
Workout C: --------XXXXXXXXXXXX------

Detected route:   XXXXXXXXXX
```

The route should represent the longest clean common traversal, not necessarily the entire overlapping area if the edges are inconsistent.

## Candidate generation

Avoid comparing every GPS sample against every other sample.

For each workout:

1. Convert its path into a coarse sequence of spatial cells.
2. Find other workouts sharing substantial ordered cell sequences.
3. Only run precise path matching for those candidate workout pairs/groups.

Possible coarse indices:

- H3
- geohash
- fixed-size projected grid

A cell size around 20–50 m is probably sufficient for candidate generation.

## Precise matching

For a candidate pair of workouts:

1. Find continuous same-direction path overlap.
2. Measure the distance of samples from the candidate path.
3. Reject discontinuous or directionally reversed matches unless explicitly supporting reverse-direction variants.
4. Find the maximal clean common interval.

Useful parameters:

```ts
maxRouteDeviationM
minSegmentDistanceM
minSegmentDurationSec
minTraversalCount
```

Initial rough defaults:

```text
max deviation:      20–30 m
minimum distance:   500 m
minimum duration:   2 min
minimum traversals: 3
```

These should be configurable, but not necessarily exposed prominently in the normal UI.

## Merge duplicate discoveries

Pairwise matching will produce many almost-identical routes.

Cluster candidate routes when they:

- occupy nearly the same physical path
- have similar start/end locations
- travel in the same direction
- overlap for most of their length

Construct one canonical route geometry from the cluster.

The canonical geometry can initially be the medoid / representative traversal rather than an averaged spline. Simpler is preferable if it is stable.

---

# 3. Segment Edge Selection

The automatically detected maximum overlap is not always the best comparison segment.

Common problem:

```text
main repeated road ---------------------
                             \
                              fountain / parking / turnoff
```

The edge of a detected route may include messy behavior that is technically shared but not desirable for comparison.

## Automatic trimming

When constructing the canonical segment, trim edges until they satisfy stronger consistency criteria than the interior.

For each point along the route, estimate:

- fraction of traversals containing that point
- median route deviation
- variance in traversal geometry
- frequency of stopping / turning nearby

Prefer the longest interval whose interior has consistently high support.

Example criterion:

```text
>= 90% of route traversals include this portion
median GPS deviation < threshold
```

This should naturally remove weakly matched tails.

## Manual trimming

The segment detail UI should allow the user to adjust the canonical start/end.

Preferred interaction:

- map shows route
- draggable start handle
- draggable end handle
- optional numeric distance trim controls

For example:

```text
Trim start:  [ 40 m ]
Trim end:    [ 25 m ]
```

Changing trim should not rerun route detection. It should define an analysis geometry derived from the detected route and immediately recompute traversals against that interval.

Persist user edits separately from detector output so automatic reruns do not destroy manual adjustments.

---

# 4. Loop Detection

Loop detection happens alongside segment detection.

A route is a loop candidate when:

- its path returns near its starting location
- total loop length is meaningfully larger than closure tolerance
- repeated workouts follow approximately the same closed geometry

Example initial rules:

```text
loop length >= 200 m
start/end closure <= 20–30 m
minimum repeated workouts >= 3
```

A ~500 m cycling track should be very easy to classify once repeated traversals are found.

## Canonical loop geometry

Represent the loop as a closed polyline with position:

```text
s ∈ [0, L)
```

where `s` is distance along the loop.

Every GPS sample in a matched workout can then be projected onto `s`.

This transforms an activity into approximately:

```text
timestamp -> loop position s
```

## Canonical start line

Even for a small ~500 m loop, use a fixed start position because there is no power data and speed can vary by position due to turns, slope, wind, surface, etc.

Choose an arbitrary but stable canonical start initially.

Later the loop UI can allow the user to move it.

Every complete lap is then:

```text
s = 0 -> L
```

and every lap traverses the same physical path.

---

# 5. Loop Occupancy and Lap Extraction

For each activity that intersects a detected loop:

1. project samples onto the canonical loop
2. require samples to remain within `maxRouteDeviationM`
3. detect entry onto the loop
4. detect canonical start-line crossings
5. extract complete laps
6. break continuity whenever the activity leaves the loop

Example:

```text
enter track
lap
lap
lap
leave toward fountain
re-enter track
lap
lap
```

This must become two independent continuous blocks, not a single five-lap effort.

The off-route excursion should therefore solve the water-fountain case automatically.

---

# 6. Comparable Loop Windows

Do not hard-code one comparison duration.

Store complete laps and continuous lap blocks. Generate comparison windows from them at query time.

Example 8-lap continuous block:

```text
3-lap windows:
1–3
2–4
3–5
4–6
5–7
6–8

5-lap windows:
1–5
2–6
3–7
4–8
```

UI should support at least:

```text
Window length: 3 / 5 / 10 laps
```

Optionally also expose approximate duration targets:

```text
~5 min
~10 min
~20 min
```

For a duration target, choose the complete-lap count closest to that duration for each workout, or simply convert the selected duration into a typical lap count for the route.

For this track use case, lap-count comparison is cleaner than arbitrary time windows.

---

# 7. Traversal Quality

Performance and data quality must be separate concepts.

A quality score should reflect whether a traversal is trustworthy, not whether it was fast.

Possible components:

```text
route match quality
GPS deviation
missing samples
GPS jumps
stops / pauses
brief off-route excursions
missing HR
obvious HR sensor artifacts
```

Example:

```text
qualityScore = 0.0–1.0
```

Use this for filtering and sorting.

Do not include speed or elapsed time in quality.

---

# 8. Detection Ranking / Route List

The main route page should show detected segments and loops together.

Example:

| Route | Type | Distance | Workouts | Traversals | Match |
|---|---|---:|---:|---:|---:|
| Polo Field loop | Loop | 510 m | 18 | 143 laps | 98% |
| JFK eastbound | Segment | 2.4 km | 31 | 36 | 96% |
| Arguello climb | Segment | 1.8 km | 14 | 15 | 94% |

Default ranking should favor routes that are both strongly matched and frequently used.

Conceptually:

```text
overallScore =
  matchStrength
  * log(1 + workoutCount)
  * log(1 + totalMatchedDistance)
```

Exact scoring should be empirical.

The important behavior is:

- strong repeated routes rise
- frequently used routes rise
- tiny overlaps are suppressed
- one weird GPS coincidence does not rank highly

Useful filters:

```text
Type: All / Segments / Loops
Sport: Cycling / Running
Minimum workouts
Minimum distance
```

---

# 9. Segment Detail UI

A segment gets its own detail page.

## Header / map

Show:

- canonical route geometry
- start marker
- end marker
- distance
- number of workouts
- number of traversals
- date range
- match strength

## Route adjustment

Allow minor manual editing:

```text
Trim start: [ 0 m ]
Trim end:   [ 0 m ]
```

Prefer draggable map handles plus numeric controls.

Changing these updates the effective comparison segment immediately.

Potential later controls:

```text
Max route deviation: [ 25 m ]
Minimum quality:      [ 90% ]
```

## Traversal table

Below the map:

| Date | Time | Avg HR | Avg Speed | Quality |
|---|---:|---:|---:|---:|
| Aug 18 | 4:31 | 168 | 27.1 km/h | 98% |
| Aug 11 | 4:44 | 165 | 25.9 km/h | 97% |
| Jul 27 | 4:56 | 167 | 24.8 km/h | 99% |

Each row should link back to the full workout if that view exists.

Possible additional columns later:

- max HR
- HR drift
- elevation gain
- cadence
- temperature

But keep the first version compact.

## Charts

At minimum:

- traversal time over date
- average speed over date
- average HR over date

Later performance modeling can add HR-adjusted metrics without changing this route UI structure.

---

# 10. Loop Detail UI

The loop page should mirror the segment page structurally, but expose lap-specific controls.

## Header / map

Show:

- canonical loop geometry
- canonical start line
- loop distance
- workout count
- complete lap count
- date range
- match strength

Allow the canonical start line to become draggable later.

## Analysis controls

Example:

```text
Window length
[ 5 laps ]

Ignore first
[ 1 lap ]

Ignore last
[ 1 lap ]

Minimum quality
[ 90% ]

Mode
(•) Representative
( ) Best
( ) All windows
```

### Representative

Pick one clean N-lap window per continuous block or workout.

Selection should optimize data cleanliness, not speed.

Prefer:

- no stops
- low GPS deviation
- complete laps
- stable sensor coverage
- interior rather than entry/exit laps when possible

### Best

Fastest N-lap window.

Useful, but explicitly represents peak effort rather than standardized fitness.

### All windows

Expose every valid overlapping N-lap window for detailed inspection.

## Workout / effort table

Example:

| Date | Window | Time | Avg HR | Avg Speed | Quality |
|---|---|---:|---:|---:|---:|
| Aug 18 | 5 laps | 9:43 | 166 | 26.3 km/h | 98% |
| Aug 11 | 5 laps | 10:01 | 167 | 25.5 km/h | 96% |
| Jul 27 | 5 laps | 10:24 | 166 | 24.6 km/h | 99% |

Clicking a row can optionally expand into individual lap times:

```text
Lap 1  1:58
Lap 2  1:57
Lap 3  1:56
Lap 4  1:57
Lap 5  1:55
```

## Charts

At minimum:

- N-lap elapsed time over date
- average speed over date
- average HR over date

Potential later chart:

- lap-by-lap pacing within selected efforts

---

# 11. Manual Adjustments vs Detection

Keep automatic detection output immutable enough that the detector can be rerun.

Store user adjustments separately.

Conceptually:

```ts
type RouteOverrides = {
  routeId: string

  trimStartM?: number
  trimEndM?: number

  loopStartOffsetM?: number

  hidden?: boolean
  customName?: string
}
```

Then:

```text
canonical detected route
        +
user overrides
        =
effective analysis route
```

This prevents future detection improvements from destroying manual tuning.

---

# 12. What Recomputes When

## Expensive / pipeline-time

These can run when rebuilding derived route data:

- repeated-path discovery
- candidate clustering
- canonical geometry generation
- segment vs loop classification
- activity-to-route matching
- raw lap extraction

## Cheap / interactive

These should ideally reduce to DuckDB queries over already-derived matches:

- segment start/end trim
- loop lap-count selection
- ignore first/last laps
- minimum quality
- representative / best / all windows
- date filtering
- sorting tables
- charts

The UI should feel instantaneous when adjusting these.

---

# 13. Implementation Order

1. **Repeated-path matcher**
   - detect common same-direction paths across workouts
   - output candidate route geometries and matches

2. **Canonical segment clustering**
   - merge duplicate candidate routes
   - compute route support and match quality

3. **Loop classifier**
   - recognize closed repeated routes
   - produce canonical loop geometry

4. **Traversal extractor**
   - extract exact segment traversals
   - project loop samples onto `s`
   - extract continuous loop blocks and laps

5. **Route list UI**
   - combined segment / loop list
   - popularity + match ranking

6. **Segment detail UI**
   - map
   - edge trimming
   - prior traversal table
   - basic trend charts

7. **Loop detail UI**
   - map + canonical start
   - N-lap controls
   - representative / best / all windows
   - prior workout table
   - lap expansion
   - basic trend charts

8. **Manual overrides persistence**
   - trims
   - loop start offset
   - names / hiding

---

# 14. First Version Constraints

For the first implementation, deliberately keep these assumptions:

- same-direction segment matches only
- no weather correction
- no power-based analysis
- complete laps only for loop comparisons
- no attempt to infer warm-up automatically
- canonical geometry can be representative rather than mathematically averaged
- manual trim overrides are allowed

That is enough to get a useful route browser and a clean longitudinal comparison surface without overcomplicating the detector.
