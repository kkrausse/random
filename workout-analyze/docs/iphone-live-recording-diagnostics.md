# iPhone live recording diagnostics

Native recording diagnostics are automatic; stopping or exporting a workout is not required.

When a development origin is selected, bounded diagnostic events are persisted on-device and retried to:

`POST <development-origin>/__workout/diagnostics`

Event IDs survive retries and launches. Network/upload failure is reported separately from recording storage health and does not mark a workout failed. `diagnostics.snapshot.telemetryDelivery` exposes the destination, queued count, last upload success, and last upload failure.

During an active recording, native sensor callbacks coalesce a `recording.health` record at most once every 12 seconds. Fields include session/state, raw GPS and heart-rate receive counts, journal durable sequence/count/last-write time/queued count, normalized durable sequence, engine checkpoint/backlog/failure, location permission and precision, location background mode, app lifecycle, Bluetooth authorization/power, and heart-rate connection state. Coordinates and raw sensor payloads are never included.

Lifecycle records use `recording.started`, `recording.paused`, `recording.resumed`, `recording.stopped`, `recording.finished`, and `recording.lifecycle.failure`.

SQLite failures include `domain`, primary `code`, `extendedCode`, SQLite `message`, exact `operation`, higher-level `contextOperation`, `sessionId`, normalized durable sequence, journal durable sequence, last successful journal write time, and queued count. These are distinct from telemetry delivery failures.

Raw Core Location and Bluetooth 2A37 deliveries are journaled before normalization or decoding. `_rawEventId` is private recorder lineage: public location/heart-rate status and read values must never contain it.
