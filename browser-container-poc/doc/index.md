# Browser workspace experiments

## Layout

- `../qemu/` — existing QEMU-Wasm app, guest image recipes, runtime patch,
  preview/HMR bridge, fixture, build scripts, and profiling harness. Local
  dependencies, generated artifacts, and build caches moved with the app.
- `../vivari/` — working browser-native fixture/preview POC and executable
  OpenCode runtime-compatibility probes.
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
- [Vivari implementation plan](vivari_plan.md) — defaults, performance and
  compatibility gates, and decision criteria for the new attempt.
- [Vivari result card](vivari-result.md) — measured warm HMR and original host
  installation blocker.
- [Vivari runtime audit](vivari-runtime-audit.md) — mainline SDK/runtime-first
  direction, builtin failures, and successful sql.js WASM database probes.
