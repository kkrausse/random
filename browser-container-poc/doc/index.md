# Browser workspace experiments

## Layout

- `../qemu/` — existing QEMU-Wasm app, guest image recipes, runtime patch,
  preview/HMR bridge, fixture, build scripts, and profiling harness. Local
  dependencies, generated artifacts, and build caches moved with the app.
- `../vivari/` — reserved for the next browser-native runtime attempt.
- This directory — research, run instructions, results, and local logs.
- `logs/qemu/` — preserved guest build log and profiling JSON reports. Raw logs
  remain local and Git-ignored, as they were before the move.

## Run the existing QEMU app

From the repository root:

```sh
cd browser-container-poc/qemu
bun run dev
```

Use the same directory for artifact, guest/runtime build, and profiling commands.
An existing dev server launched from the old location needs to be restarted from
this directory. See [the QEMU run guide](README.md) for setup and guest commands.

Host-side paths in the historical notes are relative to `qemu/` unless stated
otherwise; guest paths such as `/workspace` are unchanged. New profiling reports
go to `doc/logs/qemu/profiles/`.

## Evidence and next attempt

- [Browser result card](browser-result.md) — executed compatibility and HMR checks.
- [Profiling](profiling.md) — current latency evidence and repeatable measurements.
- [Original plan](plan.md), [assessment](assessment.md), and
  [decision matrix](decision-matrix.md) — historical research; some sections
  predate the working QEMU implementation.
- [Vivari next steps](vivari.md) — intended scope of the new attempt.
