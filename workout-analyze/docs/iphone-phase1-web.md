# iPhone phase-1 diagnostics web shell

The phase-1 React entry is a device bridge/API test harness, not a workout product UI. Diagnostics is the default route. Merely opening it reads native snapshots at a modest interval while visible; it does not request permission, start sensors, pair Bluetooth devices, or mutate a workout. Simulator output is prominently labelled and must not be treated as device evidence.

## Commands

From `workout-analyze/`:

```sh
bun run mobile:dev                 # LAN Vite server on 0.0.0.0:3001
bun run mobile:typecheck
bun run mobile:test
bun run mobile:build               # v1 engine (default)
bun run mobile:build:v2            # v2 engine behavior fixture
```

The development server URL entered on-device must be a root HTTP(S) URL, such as `http://192.168.1.20:3001/`. A phone's `localhost` is not the Mac.

## Native integration

The native target's Xcode build phase should run `bun run mobile:build` and copy the complete `mobile/dist/` directory without flattening or adding undeclared files. The output is:

```text
mobile/dist/
  manifest.json
  ui/index.html
  ui/assets/*
  engine/tiny-engine.js
```

`manifest.json` declares every payload file (but not itself), byte size, SHA-256 hash, roles, compatibility, and entry paths. UI asset references are relative for the restricted custom WK scheme. V1 is the bundled default. Building with `--engine=v2` creates an artifact that reports `phase1-engine-v2` and proves native-hosted engine behavior can change without reinstalling the shell.

The page installs `window.WorkoutAnalyzeNative` before `bridge.hello`, strictly validates typed replies and events using `src/shared/mobile`, times out unanswered requests, then uses `bridge.snapshot` when advertised to atomically install native sequence/session/permission/sensor/diagnostic/build state. Events at or below that sequence are discarded; a gap triggers a fresh atomic snapshot before queued events are applied. Legacy shells fall back to `session.snapshot`. Reload reconnects rather than creating state.

`mobile/src/store.ts` is the single Zustand application store and reactive projection of that validated native state. The bridge client remains the sequence/transport authority. The store owns one bridge subscription, one visible-only refresh loop, request lifecycle/errors, sensor/build/diagnostic actions, and leave-page probe cleanup; components use selector subscriptions and keep only unsaved form text locally.

## Harness behavior

- **Diagnostics:** native status, reason, freshness/observation age, visible-only modest refresh, isolated check results, and native export excluding workout observations.
- **Explicit sensor probes:** passive location/Bluetooth status on entry; clearly labelled user actions for permission requests, bounded foreground/background location probes, retained rich location reads, bounded BLE HR scanning, connect/disconnect, and retained rich measurement reads. Raw evidence includes accuracy/source/simulation metadata and HR flags/contact/timestamps.
- **Capability-driven UI:** controls appear only when native advertises each complete sensor API bundle. An older shell is shown as unavailable rather than being called or implied to work. Leaving Diagnostics stops an active location probe and scan.
- **Hardware-state gating:** location start remains disabled until native reports location available with usable authorization. Bluetooth scan/connect remain disabled until native reports the sensor available, authorization allowed, and power on. A discovered peripheral explicitly marked non-connectable cannot be connected.
- **Build & source utilities:** active/bundled/previous build IDs, development source configuration, HTTPS manifest download followed by explicit activation, rollback, and native UI reload.
- **Browser simulator:** opt in with `?simulator=1`; it has an explicit fixture-data banner. Fault links `?fault=timeout`, `?fault=bridge-error`, and `?fault=engine-failure` also explicitly select it. It is useful for rendering and error-state development only.
- **Unavailable features:** workout recording remains honestly unavailable. Sensor probes validate native APIs but never create or modify a workout. There is no fake Start action.

Permission prompts and location/BLE start/stop/connect operations are always user-initiated; opening Diagnostics remains read-only. A background probe is diagnostic evidence only, not a claim that workout recording works.

Navigating away from Diagnostics explicitly stops an active location probe and BLE scan. Merely hiding/backgrounding the web view does not issue web cleanup commands: native owns the contract behavior there—foreground-only location and scanning stop, while an explicitly requested background location probe or connected HR monitor may continue only when native reports/configures that support. Returning visible refreshes passive status.

The simulator is selected only by an explicit simulator/fault query. Any page without that opt-in and without a message handler—including an HTTP development source loaded inside the phone shell—fails closed as **Native bridge unavailable**; it never substitutes fixture sensor evidence. A handler that exists but times out or returns invalid data likewise remains a visible native bridge error.
