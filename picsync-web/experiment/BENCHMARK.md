# Same-image LibRaw WASM experiment

## Bun measurements — 2026-09-16 UTC

Runtime: Bun 1.4.0, macOS arm64, Apple M4 Pro, 12 logical CPUs. Decoder: the exact `libraw-wasm@1.6.0` binary also served by the browser experiment. Samples are local copies of two Sony ILCE-6700 ARWs; no native decoder or server conversion is used.

Three measured rounds after one warmup per configuration. Worker-count order rotates each round. Table values are medians, in **milliseconds**. Decode includes worker startup, input cloning, module initialization, opening, unpacking, crop development and returning RGB strips. Total adds RGBA stitching and orientation. Disk reads, hashing and worker teardown are outside the timers. Per-column medians need not sum exactly.

| Sample | Mode | Workers | Decode | Pack/orient | Total | Total min–max |
|---|---|---:|---:|---:|---:|---:|
| KEV03734 | Half | 1 | 355.8 | 6.4 | 360.3 | 360.3–373.8 |
| KEV03734 | Half | 2 | 327.2 | 4.5 | 331.6 | 328.2–344.8 |
| KEV03734 | Half | 4 | 333.5 | 6.1 | 339.6 | 336.1–349.9 |
| KEV03734 | Full | 1 | 962.4 | 24.6 | 987.0 | 986.3–987.4 |
| KEV03734 | Full | 2 | 659.1 | 24.8 | 683.1 | 683.1–704.3 |
| KEV03734 | Full | 4 | 511.3 | 25.1 | 536.4 | 535.3–537.7 |
| KEV03156 | Half | 1 | 354.4 | 24.4 | 379.8 | 377.4–385.8 |
| KEV03156 | Half | 2 | 329.4 | 23.1 | 354.0 | 352.5–354.2 |
| KEV03156 | Half | 4 | 337.5 | 24.9 | 361.4 | 360.7–363.1 |
| KEV03156 | Full | 1 | 960.9 | 171.8 | 1134.4 | 1131.2–1138.8 |
| KEV03156 | Full | 2 | 659.2 | 171.5 | 830.8 | 826.8–837.2 |
| KEV03156 | Full | 4 | 500.9 | 174.1 | 678.1 | 674.6–683.0 |

**All 48 executions, including warmups, produced the same complete RGBA hash as their one-worker baseline.** Landscape output is 6240×4168 full / 3120×2084 half; portrait output is 4168×6240 full / 2084×3120 half. This verifies the tested samples, not arbitrary Bayer files or every processing setting.

Full-resolution total speedup with four workers: **1.84× landscape, 1.67× portrait**. Half resolution improves only about 7–8% with two workers; four workers add overhead. Portrait orientation currently copies/rotates the full RGBA buffer and adds measurable cost.

### Reproduce

From `picsync-web`:

```sh
bun install --frozen-lockfile
bun run bench --rounds 3 --warmups 1 --output /path/to/results.json /path/to/KEV03734.ARW /path/to/KEV03156.ARW
```

Hashes:

```text
WASM:         8947f7e668e488461c3e9defe7007583aa8477b4886aa603b36b407f2f0846ff
KEV03734.ARW: dcf296a3445545af1d125dadc32a4f7cd15a0e2de0cf02ce7257d1796a2ad66c
KEV03156.ARW: 9f7b0f029185ef67c2ce6e109b872d4f6bcab6de0cd37427d200846b6d324047
```

## Initial browser observations

Before the Bun harness, the local browser returned KEV03734 half-resolution in 23.0s with 1.0.5 versus 2.49s with 1.6.0; the old initialization/open stage alone took 13.86s versus 0.078s. Modern full-resolution default processing took 6.76s. Versions also return different dimensions, so this is an end-to-end upgrade observation, not an isolated threading comparison.

A subsequent 12-job browser strip run on both samples, at both resolutions and all worker counts, found zero differing RGBA bytes versus each one-worker baseline. Full-resolution strip decode ranged from 6.65–6.86s with one worker, 3.75–4.09s with two, and 3.38–4.14s with four. These early browser runs did not record visibility and reported five logical CPUs, versus twelve in local Bun. Their runtime/environment and foreground state are not controlled well enough to compare absolute speed against Bun or attribute the difference solely to tab throttling. Use Bun for repeatable algorithm comparisons and device-browser checks for actual viewer latency.

## Interpretation

Keep Modern 1.6.0 as the browser experiment's default. The legacy wrapper/build was a major bottleneck; replacing the library entirely is not necessary to get a useful next experiment. Same-image parallel development provides another meaningful full-resolution improvement, but repeated whole-file unpacking, buffer copies and multiple WASM heaps limit scaling. A shared-unpack implementation would be the next architectural step if these results are insufficient.

RawSpeed3 was considered as an alternative unpacker ([LibRaw integration notes](https://github.com/LibRaw/LibRaw/blob/master/RawSpeed3/README.md)); its documented gains are format-dependent and it does not replace the complete RGB-development pipeline. It was not implemented or benchmarked here.
