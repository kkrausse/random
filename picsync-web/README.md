# PicSync web experiments

## Native image decoding on mobile Safari

Run with Bun on the machine holding the archive:

```sh
MEDIA_ROOT=/home/pi/photos HOST=192.168.1.207 LAN_CIDR=192.168.1.0/24 bun experiment/server.ts
```

Open `http://192.168.1.207:8788` on an iPhone on that LAN. Tap **Test inline image** for a JPEG control, HEIC, and RAW. Record the Safari/iOS version, outcome, and decoded dimensions. **Open original** tests direct navigation separately. Desktop Safari or an OS Quick Look preview is not a substitute for this iPhone inline-image test.

This dependency-free experiment discovers up to two files per MIME type (ARW, DNG, HEIC, JPEG), excludes hidden files and symlinks, and exposes only those sampled originals. It never changes the archive. No image conversion takes place. RAW success could reflect a decoder using an embedded preview rather than developing sensor data. Missing formats have no sample card.

It binds to the configured address and checks the actual socket peer against the configured IPv4 subnet; forwarded headers are ignored. Defaults are loopback-only. This is a temporary direct-LAN experiment, not a reverse-proxy deployment. Stop the process when finished. No dependencies or build step are required.

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
