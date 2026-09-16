# PicSync web experiments

## Native image decoding on mobile Safari

Run with Bun on the machine holding the archive:

```sh
bun install --frozen-lockfile
MEDIA_ROOT=/home/pi/photos HOST=192.168.1.207 LAN_CIDR=192.168.1.0/24 bun experiment/server.ts
```

Open `http://192.168.1.207:8788` on an iPhone on that LAN. Tap **Test inline image** for a JPEG control, HEIC, and RAW. Record the Safari/iOS version, outcome, and decoded dimensions. **Open original** tests direct navigation separately. Desktop Safari or an OS Quick Look preview is not a substitute for this iPhone inline-image test.

This experiment discovers up to two files per MIME type (ARW, DNG, HEIC, JPEG), excludes hidden files and symlinks, and exposes only those sampled originals. It never changes the archive. No server-side image conversion takes place. Native RAW success could reflect a decoder using an embedded preview rather than developing sensor data. Missing formats have no sample card.

It binds to the configured address and checks the actual socket peer against the configured IPv4 subnet; forwarded headers are ignored. Defaults are loopback-only. This is a temporary direct-LAN experiment, not a reverse-proxy deployment. Stop the process when finished. No build step is required.

## Browser-side RAW development

ARW/DNG cards offer half-resolution and full-resolution WASM decoding. Both develop sensor data using camera white balance, sRGB and 8-bit RGB output, then display an RGBA canvas. Download/decode/total times are reported, with a flag if the tab was hidden during the job. Workers are terminated on completion, failure, cancellation, page exit or the 120-second timeout. Only one RAW job and one rendered RAW canvas are retained at a time.

The decoder selector offers:

- **Legacy 1.0.5**, retained for comparison and ordinary LAN HTTP.
- **Modern 1.6.0**, installed under the `libraw-modern` package alias. This is the default on localhost / isolated HTTPS, and is dramatically faster in the initial browser measurements. The build uses shared WASM memory; that alone does not establish internal multithreaded processing.
- **Strip baseline · 1 worker**, **Parallel strips · 2 workers**, and **Parallel strips · 4 workers**. These develop different overlapping regions of **one photo**, then stitch and apply camera orientation. They use identical fixed-brightness settings so their pixels can be compared fairly.

The server sends COOP/COEP headers. Modern and strip modes require a secure, cross-origin-isolated browser context; localhost HTTP qualifies, ordinary LAN HTTP does not. All JS/WASM assets are served from installed packages without a runtime CDN dependency.

Parallel strips currently support even-sized three-color Bayer RAWs. Each worker still unpacks the complete original, but only develops its crop, with 32 sensor rows of overlap on either side. Automatic brightness and automatic maximum adjustment are disabled to avoid strip-dependent exposure. This is a same-image parallel-development experiment, not a shared-heap parallel unpacker. Four instances allocate four WASM heaps; mobile memory behavior needs device testing. The matching one-worker strip baseline also disables these automatic adjustments, unlike the normal Modern mode.

### Local Bun benchmark

Copy test originals into a local directory outside the repository. Run the actual **1.6.0 WASM binary in Bun worker threads**, using the same `decode-strip.js`, strip planning, stitching and orientation code as the browser:

```sh
bun install --frozen-lockfile
bun run bench --rounds 3 --warmups 1 --output /path/to/results.json /path/to/KEV03734.ARW /path/to/KEV03156.ARW
bun test
```

Each sample/resolution runs 1, 2 and 4 workers, with one warmup per configuration and rotating order across measured rounds. SHA-256 of the complete oriented RGBA output must match the one-worker baseline for every run; mismatches fail the benchmark. The JSON records runtime, CPU, WASM/input hashes, per-worker initialization/open and image-development timing, wall-clock decode time, packing/orientation time and total time. Input/WASM disk reads and output hashing are excluded; worker startup, input cloning and WASM initialization are included. Fresh workers/heaps mirror the viewer's lifecycle. This avoids browser background-tab throttling; it does not predict Safari latency.

Results: [local Bun measurements](experiment/BENCHMARK.md). On an Apple M4 Pro, full-resolution totals were **0.99–1.13s with one worker** and **0.54–0.68s with four**, with identical pixels across all 48 runs (including warmups). Half-resolution gains were small.

For browser integration, serve the copied originals locally:

```sh
MEDIA_ROOT=/path/to/local/samples PORT=8789 bun experiment/server.ts
```

Open `http://127.0.0.1:8789`. An optional Browser Control benchmark is in `experiment/benchmark.browser.js`; it brings its session tab forward and records focus/visibility per decode. Browser timings without controlled foreground state are exploratory. The local changes have not been deployed to the Pi.

The wrapper declares the **ISC** license and its [source/build scripts](https://github.com/ybouane/LibRaw-Wasm) are public. [LibRaw](https://www.libraw.org/about#licensing) is open source under your choice of **LGPL 2.1 or CDDL 1.0**. Both are modifiable; distributing rebuilt bundles requires retaining applicable notices and following the selected license. The wrapper's ISC declaration does not replace the underlying libraries' licenses.

Desktop Chromium verification against `KEV03734.ARW` (Sony ILCE-6700): half resolution returned 3328×2304 in 21.5s decode + 2.5s download; full resolution returned 6656×4608 in 33.6s decode + 3.0s download. The canvas was visually inspected and cancellation/clearing tested. Output contains sensor-edge black margins; no camera crop or lens correction is applied. These are desktop observations, not iPhone Safari results. Test mobile rendering and memory behavior on the actual phone.

### Running experiment on lrpi

Deployed to `/home/pi/picsync-web-experiment` as the transient user service `picsync-image-experiment`, serving `http://192.168.1.207:8788`. Stop it with:

```sh
ssh lrpi 'systemctl --user stop picsync-image-experiment'
```

Initial discovery found two Sony ARW originals and two existing JPEG thumbnails used as controls; no HEIC or DNG samples were present. Verified HTTP response bytes match the sampled ARW's SHA-256, unknown IDs return 404, POST returns 405, and a request sourced from the Pi's Tailscale address returns 403. Actual iPhone Safari rendering remains to be tested on the device.

The Pi's UFW default-deny policy also requires this LAN-only rule (installed for the experiment):

```sh
sudo ufw allow in on eth0 from 192.168.1.0/24 to 192.168.1.207 port 8788 proto tcp comment 'PicSync image experiment LAN only'
```

After adding it, both `/` and `/samples` were verified with curl from the development Mac over the LAN, not just from the Pi itself. Remove the rule when retiring the experiment:

```sh
sudo ufw delete allow in on eth0 from 192.168.1.0/24 to 192.168.1.207 port 8788 proto tcp
```

## Existing reusable pipeline ideas

- `fieldcut/server/scan.ts`: scan-time JPEG thumbnails and FFmpeg video proxies; Sony RAW conversion uses macOS `sips`, which is not available on the Pi.
- `travel-map/src/media/process-original.ts`: 384px thumbnail and 2048px viewer WebP images, embedded ARW preview extraction with ExifTool and LibRaw fallback, plus FFmpeg video posters and H.264/AAC proxies. Its on-demand max image function can still use the embedded RAW preview, so “max” is not a guarantee of full sensor resolution.

For a later gallery, reuse these techniques with lazy, cached derivatives rather than requiring a complete archive prep pass. True high-resolution RAW rendering needs an explicit full-decode path when the embedded preview is too small. Serve compatible originals directly; generate video proxies only when necessary.
