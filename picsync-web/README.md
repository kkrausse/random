# PicSync web

## Photo archive gallery

A mobile-friendly React gallery using Base UI/shadcn controls, Tailwind, and
Lucide icons. Browse folders, search filenames, resize or pinch the grid, and
open a photo with tap/click. In the viewer, pinch/scroll/double-click to zoom,
click-drag or touch-drag to pan, swipe or use arrow keys to browse, and pinch out
to return to the grid. **1:1** maps one source pixel to one physical display pixel;
**Fit** resets the view. Full sensor resolution develops automatically when a
photo opens, including before you zoom in.

Opening a photo adds `photo=<archive-relative-path>` to the URL, so copying the
link or refreshing reopens that photo. Viewer navigation updates that parameter;
Back returns to the gallery. The `scroll=<vertical-pixels>` parameter preserves
the gallery position across refreshes and history navigation (the exact photo at
that offset depends on the screen width and tile size). Scroll updates replace
the current history entry rather than adding an entry for every movement.

```sh
bun install --frozen-lockfile
# Mac server: native RAW development and embedded previews.
brew install libraw exiftool
bun run build
MEDIA_ROOT=/Volumes/Photos bun run start:lan
# Open the sign-in link printed at startup.
```

`MEDIA_ROOT` is the mounted SMB share, or the underlying archive directory when
running directly on the file server (on lrpi: `/home/pi/photos`). The browser
chooses folders inside that root; it does not speak SMB or store SMB credentials.
Only supported photo files are served, hidden entries are excluded, and resolved
paths must remain inside the archive. Folder navigation is nonrecursive and
bookmarkable. This is a read-only archive viewer.

### Loading and caching

**Default: native server conversion on the Mac.** Bun runs a bounded pool of
**ten concurrent conversion jobs**. RAW development uses LibRaw's `dcraw_emu`
with camera white balance, AHD demosaicing, full sensor resolution, and sRGB.
Sharp/libvips encodes full-resolution JPEGs at quality 92 with 4:4:4 chroma;
these are display derivatives, while **Download original** retains the exact
archive file. No RAW web workers or WASM modules start in server mode.

- Thumbnails are oriented, resized to 320px, and encoded on the server. RAW
  thumbnails use embedded JPEGs when available, with native RAW development as
  fallback. Native images are identified by signature, including JPEGs with
  misleading `.ARW` filenames. macOS `sips` handles HEIC/HEIF conversion.
- Grid thumbnails use a shared viewport observer and a six-request queue. Only
  visible tiles request previews; scrolling away cancels unfinished requests and
  removes unstarted server work, so a distant viewport does not wait behind a
  backlog of skipped tiles. Already-running native conversions finish into cache.
  Each React tile owns its loaded image URL until unmount; pipeline cache eviction
  cannot replace it with a queued placeholder. Refresh the folder to retry failed
  previews.
- Opening a photo eagerly requests its full-resolution server conversion and
  the **next ten photos**, bounded by the admission budget. Only the current
  photo and next two expand into browser bitmaps; farther-ahead JPEGs remain
  compressed. Foreground jobs take priority over queued server work.
- A metadata-keyed **512 MB / 1,024-entry server RAM cache** retains converted
  JPEGs across browsers and folder visits. Concurrent identical requests share
  work. Temporary TIFFs are removed after conversion; originals are never
  modified. Restarting clears the RAM cache.
- Navigating away drops stale queued focus requests. Already-running native
  conversions finish into the shared cache. Each native process and Sharp
  encoder uses one processing thread; ten jobs do not each start an all-core pool.
- `/api/render` uses the same authentication and archive path restrictions as
  original downloads. All photo responses remain `no-store`.

**Optional browser backend:** add `?decoder=browser` (or
`&decoder=browser` with a folder query). Folder navigation preserves this choice.
Use **localhost or trusted HTTPS** for this mode; plain LAN HTTP cannot run the
shared-memory WASM decoder. Both backends use the same grid, viewer, and bounded
full-resolution pipeline/canvas interface. The following limits describe
the retained browser-RAW backend:

**iPhone/iPad memory profile:** one page-lifetime RAW worker,
initialized with its WASM module when the gallery loads. At most six downloads
with a 192 MB admission budget, a 32 MB original cache, a 16 MB preview cache,
and up to three full-resolution images (384 MB budget; a single oversized image
is allowed). Downloads look up to ten photos ahead, bounded by the 192 MB
admission budget; only the next two photos are developed ahead. Previews load within two viewport heights
above and below the viewport, updating on resize. Includes iPadOS in
desktop browsing mode. The bundled WASM requires at least 256 MB per worker, so
mobile uses one worker and desktop uses two. RAW decoding
can grow its heap beyond 256 MB. The limits below describe the desktop profile.

- Animated photo skeletons transition to 320px previews (JPEG quality 0.72). The preview stays
  visible while full-resolution pixels develop; no blank-screen replacement.
- RAW thumbnails first request an embedded JPEG from authenticated `/api/preview`.
  ExifTool on the server tries `PreviewImage`, then `JpgFromRaw`, then `ThumbnailImage`.
  Up to ten extractions run concurrently, with a bounded queue and a 32 MB / 256-entry
  in-memory cache keyed by file metadata. No preview files are written to disk.
  Responses remain `no-store`, and camera orientation is applied to thumbnails.
  A missing embedded JPEG (204) falls back to the original; extraction errors are
  reported rather than triggering a burst of phone-side RAW decodes.
- Modern **LibRaw 1.6**, **one worker per RAW photo**, with **one RAW worker on iOS, two on desktop**
  eagerly initialized and reused across photos and folder changes. Desktop allows ten
  total image-processing slots, with RAW jobs queued onto the two workers.
  The open photo is prioritized; new background decode jobs
  pause once its original is ready, until its full-resolution render completes.
  Existing jobs finish normally.
- Up to **eight parallel downloads**, with a 256 MB admission budget for
  downloaded/queued data (one oversized original can exceed it). Download slots
  are independent of decoder slots. Embedded previews reserve at most 16 MB each;
  missing-preview fallbacks re-enter admission using the full original size.
- Preview processing within two viewport heights above and below the viewport (unstarted offscreen previews
  leave the queue), and
  full-resolution development for the next two photos. Download-only lookahead
  extends up to ten photos ahead, within the download byte budget. Those bytes
  are reused when a photo enters the development window and discarded when no
  longer ahead; large originals can fill the budget before all ten download.
- Recent originals have a 192 MB in-memory cache. Photos, listings and HTML use
  `Cache-Control: no-store`. JS/CSS/WASM use private caching with mandatory
  revalidation, avoiding repeated decoder payload transfers. Authentication runs
  before conditional requests too; revoked sessions cannot get a 304 response.
- Full-resolution results are retained as **ImageBitmaps and drawn directly to
  canvas**, not encoded as PNG. Up to three are cached within 256 MB, with the
  open photo pinned (a single oversized image is allowed). Previews have a
  separate 48 MB budget counting both JPEG bytes and estimated decoded RGBA pixels.
  Preview bitmap creation requests downsampling; temporary bitmaps are released
  before JPEG encoding. WASM heaps, active downloads and visible canvases add
  memory beyond these cache budgets. Idle workers retain their WASM heaps for
  reuse, including after ordinary photo decode errors. Folder changes cancel queued
  work; active RAW jobs finish before their workers are reused. A crashed worker or
  a 120-second worker timeout stops that worker without allocating a replacement;
  reload the page to recover. Closing/reloading the page releases the pool.

ARW/DNG use the existing Bayer strip implementation and its fixed-brightness
settings; unsupported RAW geometry produces a retryable error. JPEG, PNG, WebP,
AVIF and HEIC/HEIF use the browser's image decoder (HEIC support varies by
browser). Videos are not listed. Embedded JPEGs avoid transferring RAW originals
for thumbnails. WASM initialization happens at gallery load. Opening full resolution always requests the
original and disables LibRaw half-size processing; embedded JPEGs never enter the
original/full-resolution cache. The viewer labels the decoded source format and
pixel dimensions. A JPEG mislabeled `.ARW` can only provide its stored JPEG resolution.
Decoder selection checks file signatures: JPEG/HEIC/etc. uploaded with `.ARW`
names use the browser decoder. HEIC still requires browser support. Unknown
signatures fail before dispatching a RAW job.

Decode failures show the actual error on preview tiles and in the viewer.
Browser console entries prefixed `[PicSync]` include the photo path, resolution,
byte count and worker stage (WASM initialization, RAW open, metadata, or pixel
development), preserving object-valued LibRaw errors. Failures also POST to the
authenticated `/api/client-error` endpoint and appear as `[PicSync] Browser photo
failure` in the Bun terminal, including browser identity for phone diagnostics.
Reports are bounded to 16 KB, 20/minute per pipeline and 60/minute per server.
Server logs report denied
requests and archive failures without logging cookies, keys, or URL queries.
Sign-in redirects and denials include session status (`missing`, `expired`,
`malformed`, `invalid-signature`, or `valid`), fetch-site metadata and browser
identity, so a rejected request can be distinguished from a missing cookie.

### Phone / LAN access

For normal **server conversion**, run on the MacBook:

```sh
MEDIA_ROOT=/Volumes/Photos bun run start:lan
```

This detects the Mac's private LAN IPv4 address (preferring `en0`), listens on
port **8794**, allows peers on that interface's subnet plus localhost, and
prints a **LAN-IP sign-in link and QR code**. Open the link or scan the QR on
the same Wi-Fi/LAN. No Tailscale or HTTPS setup is required for server conversion.
The existing sign-in gate and Keychain credentials remain in use.

Select another interface/port with `LAN_IP=192.168.1.184 PORT=8794` if needed.
For explicit configuration instead of automatic detection:

```sh
MEDIA_ROOT=/Volumes/Photos HOST=0.0.0.0 PORT=8794 LAN_CIDR=192.168.1.0/24 \
  PICSYNC_LAN_URL=http://192.168.1.184:8794 bun run start
```

Only an explicitly configured private IPv4 LAN origin is accepted for remote
HTTP sign-in. The socket peer must be in the configured subnet; forwarded
headers do not grant access. `bun run start` without LAN settings stays
loopback-only. If the Mac's LAN IP changes, restart `start:lan` and use its new QR.

For the optional **browser RAW backend**, Modern LibRaw requires shared WASM
memory: trusted HTTPS and cross-origin isolation, or localhost. To serve that
mode over LAN HTTPS with a certificate already trusted by the phone:

```sh
MEDIA_ROOT=/home/pi/photos HOST=192.168.1.207 LAN_CIDR=192.168.1.0/24 \
  TLS_CERT=/path/to/cert.pem TLS_KEY=/path/to/key.pem PORT=8789 bun run start
```

Also set `PICSYNC_PUBLIC_URL` to the trusted HTTPS origin. Mobile viewport/touch
testing in Chromium is covered below; actual iPhone Safari performance remains
to be tested.

### Running archive instance

The gallery now runs on the **MacBook**, reading the Pi's SMB archive mounted at
`/Volumes/Photos` (`smb://pi@192.168.1.207/Photos`). The Pi's gallery process and
old experiment/gallery services are stopped; it only provides archive storage.

**LAN: http://192.168.1.184:8794/** (current MacBook address; use the startup
sign-in link/QR to authenticate). Local Mac access also works at
**http://localhost:8794/**, with a separate origin-bound sign-in.

**Funnel is disabled and the gallery's Tailscale Serve route on 8443 is removed.**
Verified with `tailscale funnel status` and `tailscale serve status --json`:
only the separate tailnet-only port 443 app on local port 3000 remains. There is
no gallery Funnel/public route or gallery Tailscale proxy.

```sh
# With the Photos share mounted, run from picsync-web on the Mac:
MEDIA_ROOT=/Volumes/Photos bun run start:lan
# Confirm public sharing remains disabled:
tailscale funnel status
tailscale serve status --json
```

The Mac must be awake, the SMB share mounted, and the Bun process running. No
launch agent or persistent app service was installed. Verified direct LAN
reachability from the Pi and a browser-rendered **6240 × 4168** server-developed
RAW canvas with zero RAW-worker/WASM/original downloads. Focus mode requested
the open photo plus ten full-resolution derivatives; a prefetched next photo
displayed in approximately 78 ms in an exploratory desktop check. A separate
cold native conversion of one ARW took approximately 4.4 seconds; eager
conversion/caching avoids that repeat cost, but cold photos still require work.

### Sign-in gate

`app/auth.ts` is a standalone request guard based on bun-web-terminal's auth.
It runs before every gallery route, including HTML, JS, CSS, workers, WASM,
folder listings, and original photos. Only `/login` (minimal standalone HTML)
and `POST /api/auth/login` are public. Unauthenticated navigations redirect to
sign-in; other requests receive 401. Network restrictions still apply first.

Startup prints a sign-in link and QR code containing a random 256-bit access
key in a URL fragment. The login page clears the fragment and exchanges the key
for a signed, origin-bound, HttpOnly, SameSite=Strict cookie (Secure on HTTPS).
Cookies last 30 days. Links grant access to the entire archive; keep them private.

macOS Keychain stores independent PicSync credentials under service
`picsync-web.auth.v1`, account `port-<PORT>`. Keeping the same port preserves
links and browser sessions across code changes and restarts. Keychain errors
fail startup rather than silently switching credentials. To revoke all access:
stop the server, run `PORT=8794 bun run auth:reset` (use your server's port),
then start it again and use the new link. Restarting alone does not revoke access.

For optional HTTPS deployment, set `PICSYNC_PUBLIC_URL` to the exact externally used HTTPS origin, including
its port. This is required for Tailscale Serve or future Funnel use; arbitrary
hosts and forwarded headers are not trusted. When exposing via Funnel, retain
the loopback bind and let Tailscale terminate HTTPS. The same sign-in gate applies
to public traffic. Already-open
photos may remain in the app's memory until the page closes; revocation blocks
subsequent server requests, not copies already downloaded.

### Verification

```sh
bun run typecheck
bun run build
bun test
```

`app/verify.browser.js` is a Browser Control CLI integration check for the optional
**browser backend**; select `?decoder=browser` in the authenticated fixture. Serve a
disposable fixture at port 8792 containing a `Test album` folder with twelve RAW
files named `Photo 1.ARW` through `Photo 12.ARW`. Sign the Browser Control session
into that fixture using its startup link, then run in that same session:

```sh
browser-control execute --session <session-id> --file app/verify.browser.js
```

To exercise the iPhone scheduling profile in Chromium, use a fresh authenticated
session, run `browser-control execute --session <session-id> 'state.verifyIOS = true'`,
then the same script. The check expects twelve 320px embedded previews with no RAW
decode jobs or original downloads for the grid, one eagerly initialized iOS worker
(two on desktop), at most three developed photos, and worker reuse across folder
changes. This simulates device detection; it does not verify Safari's memory ceiling.

Previously verified at 390 × 844: folder selection, twelve previews, 6240 × 4168 full-size
canvas, 1:1 pixel zoom, click-drag panning, real Chromium two-touch pinch back to
the grid, no horizontal overflow, and exactly one embedded-preview request per
photo. The new page-lifetime worker behavior still needs browser/device verification.
A portrait ARW verifies camera
orientation and a JPEG named `.ARW` verifies the no-embedded-preview fallback.

Performance correction: the initial gallery PNG conversion added about 2.2s to
one full-resolution image. Direct bitmap/canvas display removed that conversion;
a foreground localhost measurement after previews loaded reached full resolution
in **0.91s from click**. These are exploratory desktop measurements, not a phone
benchmark; browser background throttling materially affects results.

## Earlier experiments

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
