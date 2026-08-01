# Kindle Context POC

Android proof of concept for capturing highlighted Kindle text and its visible-page context on a BOOX Palma 2. The app uses an accessibility service with spoken feedback so Kindle exposes its virtual prose nodes.

## Current Flow

1. Highlight text in Kindle so its selection toolbar is visible.
2. Press the floating `K` accessibility shortcut.
3. The service captures prose nodes that intersect the physical display.
4. The service invokes Kindle's exposed `Copy` action.
5. The POC opens, becomes the focused app, and reads the copied highlight with Android's foreground clipboard access.

If Kindle does not expose `Copy` or readable clipboard text, the app falls back to standard accessibility selection offsets and reports when neither path supplies highlighted text.

Kindle retains the copied selection as an annotation. Automatic deletion is intentionally not attempted because Copy closes and invalidates the selection toolbar before its accessible `Delete Highlight` action can run. See `progress_20260801_113544.md` for the tested alternatives and evidence.

## Local Setup

The Android SDK is installed without Android Studio:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ADB="$ANDROID_HOME/platform-tools/adb"
```

The tested device serial is `BOOX_DEVICE_SERIAL`. Check the current connection before device commands:

```sh
"$ADB" devices -l
```

On the Palma 2, USB debugging is available under `Settings -> More Settings -> USB Debug Mode`.

## Build And Install

Build and run Android lint:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew --no-daemon clean assembleDebug lintDebug
```

Install the debug APK and launch it:

```sh
export ADB="$HOME/Library/Android/sdk/platform-tools/adb"
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk
"$ADB" shell am start -n dev.example.kindlecontext/.MainActivity
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## BOOX Configuration

Disable freezing for `Kindle Context POC` under `Settings -> Apps & Notifications -> Freeze Settings / App Freeze`. BOOX freezing disables the package, kills the service, removes it from enabled accessibility services, and clears the accessibility-button target.

After installing an APK, verify:

1. `Kindle Context POC` is not frozen.
2. `Kindle Context Capture` is enabled in Android accessibility settings.
3. The floating `K` button targets `Kindle Context Capture`.

The separate BOOX NaviBall service can remain enabled.

## Accessibility Recovery

Inspect the current state:

```sh
"$ADB" shell dumpsys accessibility
"$ADB" shell settings get secure enabled_accessibility_services
"$ADB" shell settings get secure accessibility_button_targets
```

Development-only recovery commands that preserve NaviBall:

```sh
"$ADB" shell pm enable dev.example.kindlecontext
"$ADB" shell settings put secure enabled_accessibility_services \
  'com.onyx.floatingbutton/.service.FloatButtonAccessibilityService:dev.example.kindlecontext/dev.example.kindlecontext.KindleAccessibilityService'
"$ADB" shell settings put secure accessibility_enabled 1
"$ADB" shell settings put secure accessibility_button_targets \
  'dev.example.kindlecontext/dev.example.kindlecontext.KindleAccessibilityService'
```

If Android still lists the service as crashed, toggle only `Kindle Context Capture` off and on in accessibility settings.

## Diagnostics

Follow app logs:

```sh
"$ADB" logcat -s KindleContext
```

Capture Kindle's UI Automator hierarchy:

```sh
"$ADB" shell uiautomator dump /sdcard/kindle-window.xml
"$ADB" pull /sdcard/kindle-window.xml .
```

Pull the debug app's private accessibility diagnostics:

```sh
"$ADB" exec-out run-as dev.example.kindlecontext \
  cat files/kindle-accessibility-tree.txt > kindle-accessibility-tree.txt
"$ADB" exec-out run-as dev.example.kindlecontext \
  cat files/kindle-accessibility-events.txt > kindle-accessibility-events.txt
```

These files contain book prose. Keep them local and remove or gate this diagnostic persistence before production use.

## Removal

```sh
"$ADB" uninstall dev.example.kindlecontext
```

Uninstalling removes the app's private captures and preferences. It does not affect BOOX NaviBall.
