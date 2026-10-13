./README.md has build / install instructions
commit after you finish a code change
The production server is OpenCode Server v2 (`@opencode/cli`, version pinned in `server/deploy.sh`). All OpenCode access goes through the shared client in `./client` (`reading-context-client`, over the official `@opencode/client` pinned to the same version); do not add direct HTTP calls to the Chrome extension or the Android app. `./client/README.md` documents its API and the Android WebView bridge contract. Use the `@opencode/client` types, or the running server's `/openapi.json`, for the API contract.
After changing `client/src` or the `@opencode/client` pin, run `cd client && bun run check && bun run build:android` and commit the rebuilt `app/src/main/assets/reading-client.js` with the change.
Never test against a real model or the real server. `cd client && bun run verify` and `bun run verify:bridge` start a throwaway local server with isolated data and a fake provider; `bun run scripts/dev-server.ts` keeps one running for manual work.
In v2 a bare `opencode` command talks to a per-user background service. To address the reading server, pass `--server <url>` with `OPENCODE_SERVER_PASSWORD` set.
`server/runtime/opencode.json` is deny-by-default (`"*": "deny"` first, then allows; the last matching rule wins). Keep it that way: v2 agents otherwise start with every tool allowed.

## Palma 2 device-test preflight

- The installed Reading Context app is `dev.kkrausse.kindlecontext`. Before installing, compare the APK's application ID and signing certificate with the installed app. Do not install a second package ID for testing without explicitly explaining it and getting the user's approval; it creates duplicate app icons and accessibility shortcuts.
- BOOX automatically freezes newly installed apps and may re-freeze after updates. In the BOOX launcher, open **Settings -> Apps & Notifications -> Freeze Settings / App Freeze**, find **Reading Context**, and turn freezing **off**. `pm enable` alone does not persist: freezing disables the package, removes the accessibility service, and clears the floating-button target as soon as the app backgrounds.
- Check `adb shell settings get secure enabled_accessibility_services` and `adb shell settings get secure accessibility_button_targets` before and after a test. Preserve the separate NaviBall service and restore any shortcut changed for testing. The exact recovery commands and checks are in `README.md` under **BOOX Configuration** and **Accessibility Recovery**.
- Never uninstall the existing app to fix a signing or package mismatch: uninstalling destroys private captures and connection settings. Resolve the build mismatch first.
- Google Chrome is `com.android.chrome`. Do not use the BOOX NeoBrowser (`org.chromium.chrome`) as a stand-in for Chrome; it has separate network restrictions on this device.
