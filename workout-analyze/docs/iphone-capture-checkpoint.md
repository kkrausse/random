# iPhone raw capture checkpoint

The temporary native recorder keeps the existing Swift architecture and treats its SQLite raw journal as the capture source of truth.

## Installed acceptance

- Start creates a durable session before sensor startup.
- Active and paused sessions run Core Location independently of the web view with fitness activity, navigation-grade requested accuracy, no distance filter, automatic pausing disabled, and background delivery enabled.
- `UIBackgroundModes` includes `location` and `bluetooth-central`; a connected BLE heart-rate peripheral remains subscribed when iOS permits background central delivery.
- Every Core Location callback item is committed in original callback order before validation, sorting, deduplication, normalization, or engine work. Batch ID/index/size, source and receipt timestamps, accuracy, altitude, speed, course, floor, source flags, authorization, and available fields are retained.
- Every delivered Heart Rate Measurement value is committed as exact base64 bytes before decode. Empty, errored, malformed, duplicate, and unknown values remain in the raw journal.
- Lifecycle, permission, Bluetooth state, disconnect, decode failure, normalization rejection, pause/resume/finish, interruption, and recovery events are retained while a session exists.
- SQLite uses WAL, full synchronous commits, and Complete Until First User Authentication protection so an already-unlocked phone can continue journal writes after screen lock.
- Stop commits the finish event and session row before acknowledgement. `archive.list`, `archive.detail`, `journal.read`, and lossless bundle export reopen finished data independently of current web state or metrics-engine success.

## Physical lock test

This cannot be established by simulator evidence. On the installed phone: grant Location with Precise enabled, tap **Start ride**, wait for a fix, lock the phone for at least 60 seconds while moving outdoors, unlock, tap **Stop & save**, open **Saved workouts**, open the ride, and export the lossless bundle. Verification requires journal rows received during the background lifecycle interval and successful archive/journal access after relaunch.

Swiping the app away (force quit) is excluded from continuous background capture; launch recovery preserves the durable prefix and records the interruption gap.
