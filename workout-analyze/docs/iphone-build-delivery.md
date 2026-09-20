# iPhone installed-build delivery

The Settings screen defaults to this private tailnet URL:

```text
https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/__workout/build/manifest.json
```

It is available only while the Mac is online, Tailscale is connected on both devices, and the mobile Vite development server is running on port 4317. Tailscale Serve terminates trusted HTTPS on port 8443 and proxies the whole Vite server, including HMR WebSockets, diagnostics, and installed-build delivery. Port 443 and its existing root handler remain untouched.

Settings offers the same HTTPS origin as an explicit draft action. It does not infer the native source from `window.location`, build identity, or bridge health, and does not switch sources until **Connect** is pressed. Configured, target, loaded, load-state, current-failure, and historical-failure values are projected through the Zustand store from the validated native `webBuild` diagnostics row. Polling initializes the draft from a configured development URL only while the draft is clean. Direct `http://100.86.29.19:4317/` access remains available as the current development source; the Vite client uses that page's own HMR origin rather than redirecting it.

## Publish a build

From `workout-analyze`:

```sh
bun run mobile:build
```

This writes the independently installable artifact to `mobile/dist`. The development-only Vite endpoint reads that directory, serves `manifest.json`, and serves only files declared by the current manifest. It rejects traversal, undeclared files, oversized declarations, and files whose current size differs from the manifest. `mobile/dist` is excluded from Vite's watcher so publishing does not trigger an HMR loop.

The native shell downloads every declared path relative to the manifest URL and independently verifies each exact byte count and SHA-256 hash before activation. In Settings, **Download, activate & reload** performs the complete install flow; no development-source URL is needed for the installed build.

## Tailscale Serve route

Inspect before changing it:

```sh
tailscale serve status --json
```

The intended configuration keeps the existing port-443 `/` handler and adds a separate listener:

```text
https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/ -> http://127.0.0.1:4317
```

Do not enable Funnel. If Tailscale reports that HTTPS certificates require tailnet-owner approval, approve HTTPS for this tailnet and retry the Serve command; do not fall back to HTTP because the native installed-build contract requires HTTPS.

## Verify

```sh
curl --fail --silent --show-error \
  https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/__workout/build/manifest.json
```

After publishing a new build, its generated `buildId` must be new. The native shell intentionally refuses to overwrite an already-installed build with the same ID.
