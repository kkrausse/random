./README.md has build / install instructions
commit after you finish a code change
The production server uses regular OpenCode `1.18.13`, not OpenCode V2. Use the installed `@opencode-ai/sdk@1.18.13` generated types for its API contract. `./docs/opencode-v2-openapi.json` describes only the retired beta server and is retained for migration history; do not use it for current client work.

## Palma 2 device-test preflight

- The installed Reading Context app is `dev.kkrausse.kindlecontext`. Before installing, compare the APK's application ID and signing certificate with the installed app. Do not install a second package ID for testing without explicitly explaining it and getting the user's approval; it creates duplicate app icons and accessibility shortcuts.
- BOOX automatically freezes newly installed apps and may re-freeze after updates. In the BOOX launcher, open **Settings -> Apps & Notifications -> Freeze Settings / App Freeze**, find **Reading Context**, and turn freezing **off**. `pm enable` alone does not persist: freezing disables the package, removes the accessibility service, and clears the floating-button target as soon as the app backgrounds.
- Check `adb shell settings get secure enabled_accessibility_services` and `adb shell settings get secure accessibility_button_targets` before and after a test. Preserve the separate NaviBall service and restore any shortcut changed for testing. The exact recovery commands and checks are in `README.md` under **BOOX Configuration** and **Accessibility Recovery**.
- Never uninstall the existing app to fix a signing or package mismatch: uninstalling destroys private captures and connection settings. Resolve the build mismatch first.
- Google Chrome is `com.android.chrome`. Do not use the BOOX NeoBrowser (`org.chromium.chrome`) as a stand-in for Chrome; it has separate network restrictions on this device.
