# Phone segment analysis capture — September 23, 2026

The connected iPhone's `Library/Application Support` was copied without modifying the device to the ignored `data/phone-recovery-2026-09-23/`. Preserve both DuckDB files, their WALs, and the separate recorder SQLite files. The native-compatible analysis store is `WorkoutAnalyze/analysis-native.duckdb` plus `.wal`; its saved config has `minSegmentDistanceM: 500`, `minSegmentSupportJaccard: 0`, and `maxRoutesPerSport: 12`.

From `workout-analyze`, run:

```sh
bun run scripts/replay-captured-analysis.ts
```

The script copies the database **and WAL** into a disposable directory, loads all normalized workouts through the same `readNormalizedActivities` SQL used by mobile, runs the shared `detectRoutes` with the phone's saved config, and compares each route ID, workout count, and traversal count to the stored analysis. It never opens the captured source in place. Supply an alternate database path as the first argument to replay another capture.

On this capture: 173 activities, 195,928 samples, 31 route IDs, and 1,477 traversals replay with no missing/extra route IDs or changed support counts. One cycling loop is 1,094 m with 200 traversals; six near-complete cycling segments of 867–995 m appear alongside it with 168–199 traversals each. The original Mac `data/fitness.duckdb` has the same settings and activity/sample totals, but its analysis has 1,313 traversals and five different cycling segment IDs. Per-activity normalized-value hashes match for 171 of 173 workouts; the other two iPhone rides have the same metadata and sample counts but differing order for pairs of equal-timestamp samples. Use the captured phone store for phone-exact experiments.

The live iPhone currently does **not** expose `database.query`: native DuckDB 1.1.3 fails to initialize while replaying `analysis-native.duckdb.wal`, reporting an ART index assertion (`depth < key.get().len`). The original `analysis.duckdb` is preserved too. Mac DuckDB 1.5.5 can replay the WAL on a disposable copy, so a successful Mac replay demonstrates reproducibility of the shared TypeScript detector, not that the installed native DuckDB can currently open the file. Do not overwrite the phone's database or recorder journal to run this reproduction.
