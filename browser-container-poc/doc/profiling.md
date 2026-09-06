# Performance feedback loop

Run host commands from `browser-container-poc/qemu/`. Existing profiling reports
were moved into `doc/logs/qemu/profiles/` alongside the other local logs.

## Run against the working VM

Keep `bun run dev` running. Once the guest Vite preview is connected and displays
the fixture, find its Browser Control session with `browser-control session list`.
The existing working session at the time of this investigation is `amber-walrus-881`.

```sh
# Three preview reloads, three cached HTTP probes, three edit/restore cycles:
bun run profile amber-walrus-881

# Isolate a phase / increase the sample count:
bun run profile amber-walrus-881 5 edit
bun run profile amber-walrus-881 3 reload
bun run profile amber-walrus-881 3 http
```

This uses the Bun-backed `browser-control` CLI and the existing browser VM. Each
sample is printed and saved to `../doc/logs/qemu/profiles/<timestamp>-<mode>.json` as it
finishes. Run only one profiling command at a time, keep the browser foregrounded,
and avoid guest edits or other heavy workloads during a run.

- **edit:** read the current `src/WelcomeCard.tsx`, temporarily change its plain-text
  heading, wait for the visible result, verify the preview document survived, then
  restore the exact source and wait for the original heading. Restoration also runs
  on failure. This is a fixture-specific benchmark; it requires a plain-text `<h1>`.
  Don't interrupt the process or close the tab during a sample.
- **reload:** replace only the preview document, timing until its heading appears.
  The VM, running Vite process, dependency cache, and emulation warm-up survive.
  Heading visibility does not mean every image has finished loading.
  This includes automation dispatch/readiness overhead, so treat it as an upper
  bound and use the individual resource durations for detailed comparisons.
- **http:** fetch the cached module with guest curl, then through the real serial
  bridge. The curl warm-up makes this a cached-delivery comparison, not a transform
  benchmark. Curl's duration is a guest-clock measurement; browser round-trip and
  visible timings use the host clock.

The observer is installed in place, without reloading the workspace. It keeps the
latest 200 transport samples on `runtime.contentWindow.guestBridge.profile.samples`.
Browser-side request timings and response sizes work with the already-running
bridge. New connections also return guest `fetchMs`, `gzipMs`, and uncompressed
byte counts from the updated `guest/preview-bridge.ts`. Those guest durations use
the guest clock; do not subtract them from host durations as exact CPU/transport
accounting. An already-connected guest continues running its original bridge until
a new VM/connect cycle.

The preview worker now retains up to 32 **versioned, explicitly immutable Vite
dependency responses** in memory. A new bridge connection clears this cache and
waits for acknowledgement before loading the preview. Source modules, HTML, errors,
and unversioned/mutable responses are always fetched from the guest. This is a
best-effort cache: browser service-worker eviction can discard it. The first
reload populates it; subsequent reloads should avoid repeating large dependency
transfers. It is not a cold-load or transformed-module optimization.

## Initial measurements — September 5, 2026

Same existing VM, already past cold dependency optimization. No runtime or Vite
optimization was applied between these batches.

| Batch | Visible edit latency | Write command | HMR notification | Updated module request |
| --- | --- | --- | --- | --- |
| First 3 edits | 4.734 / 11.230 / 6.041 s | 0.262–0.505 s | 0.540–0.736 s | 4.170–10.664 s |
| Next 3 edits | 3.746 / 2.696 / 1.982 s | 0.273–0.391 s | 0.332–0.711 s | 1.618–3.010 s |

Updated responses were only **2,649 bytes on the serial wire**. Cached probes of
the restored module took **196 / 170 / 146 ms** end to end (2,392 base64 characters,
4,352 uncompressed bytes). Guest-loopback curl reported **64–80 ms**.

### Reload cache experiment

With the new dependency cache installed in the existing VM, the complete `all`
command passed all nine samples:

| Phase | Samples |
| --- | --- |
| Preview reload (first populates cache) | 40.125 / 13.993 / 13.615 s |
| Cached module through serial, after reloads | 0.746 / 0.388 / 0.458 s |
| Edit-to-visible after reloads | 23.210 / 8.120 / 4.165 s |

A final focused edit completed in **1.883 s** (command 0.173 s, notification
0.211 s, module request 1.643 s), and restored the original heading/source.

On the first reload, React DOM and Lucide took about 15–16 seconds apiece and sent
207 KB / 252 KB of serial protocol data. On subsequent reloads, their resource
durations were **under 1 ms** and no corresponding guest HTTP requests occurred.
This verifies the cache's effect, although the aggregate 40→14-second difference
also includes run-order/warm-up effects. Remaining reload costs include Vite's HMR
client and React Refresh runtime, which are not marked immutable and still traverse
the bridge. The cache does not mask HMR: all three subsequent edits fetched their
updated source from the guest and preserved the document.

The first attempted reload left the preview blank with a missing module response
and the bridge's aggregate error counter at 1; the counter covers both parsing and
message dispatch, so the exact cause remains unresolved. A subsequent preview-only
reload recovered successfully. Browser Control also returned an execution-context
error when child navigation happened inside a long parent evaluation; the harness
now splits navigation and observation. See `browser-control-todo.md`.

### Interpretation

The earlier 15.114-second edit is not a steady-state constant. Repetition helps
substantially, but these short batches also show considerable variance. The HMR
notification is relatively quick; fetching the invalidated module dominates. Warm
cached delivery is an order of magnitude faster, pointing toward guest-side
transformation and emulation/JSC warm-up rather than serial bandwidth. This does
not yet separate Babel, esbuild, Vite bookkeeping, guest scheduling, and QEMU JIT.

### Next experiments

1. Use new-bridge guest timings to split Vite fetch/body work from gzip work.
2. Start guest Vite with `DEBUG=vite:transform,vite:hmr` and
   `BUN_JSC_useFTLJIT=false`, logging to `/tmp/vite-dev.log`. Correlate its transform
   logs with the browser-side module timings. Preserve Fast Refresh when comparing
   transformer alternatives.
3. Compare at least five warm edit samples before/after a single change, recording
   sample order. Include restoration edits in the warm-up interpretation: each
   measured edit is followed by another real transform to restore the source.
4. Separately measure a fresh VM's first preview and investigate baking dependency
   optimization into the image. Preview reloads here deliberately measure warm-VM
   behavior; they do not simulate cold boot or clear Vite caches.

The feedback loop avoids VM/image rebuilds and manual guest edit commands for every
measurement. The dependency cache demonstrably removes large transfers on repeat
reloads. The separate edit-latency reductions are warm-up evidence, **not a claimed
transform optimization**. Reloading does not guarantee subsequent edits stay fast:
the post-reload batch rose to 23 seconds before falling again.
