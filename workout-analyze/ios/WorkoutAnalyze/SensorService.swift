@preconcurrency import CoreBluetooth
@preconcurrency import CoreLocation
import Foundation
import UIKit

@MainActor
final class SensorService: NSObject, @MainActor CLLocationManagerDelegate, @MainActor CBCentralManagerDelegate, @MainActor CBPeripheralDelegate {
    var emitEvent: ((String, [String: Any]) -> Void)?
    var recordLocation: (([String: Any]) -> Void)?
    var recordHeartRate: (([String: Any]) -> Void)?
    var recordRawLocation: (([String: Any]) -> Void)?
    var recordRawHeartRate: (([String: Any]) -> Void)?
    var recordHostEvent: ((String, [String: Any]) -> Void)?
    private let log: DiagnosticLog

    private lazy var locationManager: CLLocationManager = {
        let manager = CLLocationManager()
        manager.delegate = self
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        return manager
    }()
    private var locationState = "inactive"
    private var locationReason = "No location probe is active"
    private var probeId: String?
    private var locationStartedAt: String?
    private var locationExpiresAt: String?
    private var locationBackgroundMode: String?
    private var locationBackgroundActive = false
    private var locationReceived = 0
    private var locationAccepted = 0
    private var locationRejected = 0
    private var locationLastRejection: String?
    private var locationLastError: String?
    private var locationCursor = 0
    private var locations: [[String: Any]] = []
    private var locationExpiryTask: Task<Void, Never>?
    private var locationEventTask: Task<Void, Never>?
    private var lastLocationEvent = Date.distantPast
    private var recordingLocationActive = false

    private var central: CBCentralManager?
    private var bluetoothPower = "unknown"
    private var heartRateState = "inactive"
    private var heartRateReason = "No scan or heart-rate connection is active"
    private var scanEndsAt: String?
    private var scanTask: Task<Void, Never>?
    private var devices: [UUID: [String: Any]] = [:]
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var connectionId: String?
    private var selectedPeripheral: CBPeripheral?
    private var explicitDisconnect = false
    private var heartRateReceived = 0
    private var parseErrors = 0
    private var reconnectCount = 0
    private var heartRateCursor = 0
    private var measurements: [[String: Any]] = []
    private var heartRateLastError: String?
    private var heartRateEventTask: Task<Void, Never>?
    private var lastHeartRateEvent = Date.distantPast

    init(log: DiagnosticLog) {
        self.log = log
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(lifecycleChanged), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(lifecycleChanged), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(lifecycleChanged), name: UIApplication.willResignActiveNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    var implementedCapabilities: [String] {
        ["permissions.request", "bridge.snapshot", "location.status", "location.start", "location.stop", "location.read", "heartRate.status", "heartRate.scan", "heartRate.stopScan", "heartRate.connect", "heartRate.disconnect", "heartRate.read"]
    }

    func permissionStatus(row: (_ id: String, _ label: String, _ status: String, _ reason: String, _ observedAt: String?, _ freshness: String, _ details: [String: Any]) -> [String: Any]) -> [String: Any] {
        let now = ISOTime.now()
        let authorization = locationAuthorization()
        let bluetooth = bluetoothAuthorization()
        let locationStatus = ["denied", "restricted"].contains(authorization) ? "unavailable" : (authorization == "notDetermined" ? "waiting" : "ok")
        let bluetoothStatus = ["denied", "restricted"].contains(bluetooth) ? "unavailable" : (bluetooth == "notDetermined" ? "waiting" : "ok")
        return [
            "location": row("location.permission", "Location permission", locationStatus, permissionReason(name: "Location", authorization: authorization), now, "fresh", ["authorization": authorization, "precise": locationPrecision()]),
            "bluetooth": row("bluetooth.permission", "Bluetooth permission", bluetoothStatus, permissionReason(name: "Bluetooth", authorization: bluetooth), now, "fresh", ["authorization": bluetooth, "power": bluetooth == "denied" ? "unauthorized" : bluetoothPower]),
            "promptsAutomatically": false
        ]
    }

    func requestPermission(_ permission: String) {
        recordHostEvent?("permissionRequest", ["permission": permission, "sourceTimestamp": ISOTime.now()])
        if permission == "locationWhenInUse" {
            locationManager.requestWhenInUseAuthorization()
            log.append(subsystem: "permission", message: "User-triggered location permission request")
        } else {
            ensureCentral()
            log.append(subsystem: "permission", message: "User-triggered Bluetooth permission request")
        }
    }

    func startLocation(desiredAccuracy: String, distanceFilter: Double, backgroundMode: String, duration: Int) throws -> [String: Any] {
        guard locationState == "inactive" || locationState == "error" else { throw ShellError.invalidState("A location probe is already active") }
        guard CLLocationManager.locationServicesEnabled() else { throw ShellError.sensorUnavailable("Location services are disabled") }
        guard ["whenInUse", "always"].contains(locationAuthorization()) else { throw ShellError.permissionDenied("Location permission must be granted explicitly before starting") }
        locationExpiryTask?.cancel()
        probeId = "loc-\(UUID().uuidString)"
        locationStartedAt = ISOTime.now()
        let expiry = Date().addingTimeInterval(TimeInterval(duration))
        locationExpiresAt = ISO8601DateFormatter().string(from: expiry)
        locationBackgroundMode = backgroundMode
        locationReceived = 0; locationAccepted = 0; locationRejected = 0; locationCursor = 0
        locationLastRejection = nil; locationLastError = nil; locations.removeAll(keepingCapacity: true)
        locationManager.desiredAccuracy = desiredAccuracy == "best" ? kCLLocationAccuracyBest : (desiredAccuracy == "nearestTenMeters" ? kCLLocationAccuracyNearestTenMeters : kCLLocationAccuracyHundredMeters)
        locationManager.distanceFilter = distanceFilter
        locationBackgroundActive = backgroundMode == "continueWhenBackgrounded"
        locationManager.allowsBackgroundLocationUpdates = locationBackgroundActive
        locationManager.showsBackgroundLocationIndicator = locationBackgroundActive
        locationState = "starting"; locationReason = "Waiting for the first Core Location observation"
        locationManager.startUpdatingLocation()
        locationState = "active"
        locationExpiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            self?.stopLocationInternally(reason: "Location probe reached its maximum duration")
        }
        emitEvent?("location.updated", locationStatus())
        return locationStatus()
    }

    func stopLocation(id: String) throws -> [String: Any] {
        guard id == probeId else { throw ShellError.invalidState("Probe ID does not match the current location probe") }
        if locationState != "inactive" { stopLocationInternally(reason: "Location probe stopped explicitly") }
        return locationStatus()
    }

    func locationStatus() -> [String: Any] {
        let available = CLLocationManager.locationServicesEnabled()
        return [
            "availability": available ? "available" : "unavailable", "state": locationState,
            "reason": available ? locationReason : "Location services are disabled on this device",
            "probeId": probeId ?? NSNull(), "startedAt": locationStartedAt ?? NSNull(), "expiresAt": locationExpiresAt ?? NSNull(),
            "backgroundMode": locationBackgroundMode ?? NSNull(), "backgroundDeliveryActive": locationBackgroundActive,
            "appLifecycle": appLifecycle(), "receivedCount": locationReceived, "acceptedCount": locationAccepted,
            "rejectedCount": locationRejected, "lastRejectionReason": locationLastRejection ?? NSNull(),
            "retainedCount": locations.count, "oldestCursor": locations.first?["cursor"] ?? NSNull(),
            "latestCursor": locations.last?["cursor"] ?? NSNull(), "latestObservation": locations.last ?? NSNull(),
            "lastError": locationLastError ?? NSNull()
        ]
    }

    func readLocations(id: String, after: Int?, limit: Int) throws -> [String: Any] {
        guard id == probeId else { throw ShellError.invalidState("Probe ID does not match the retained location stream") }
        return page(items: locations, after: after, limit: limit)
    }

    func startRecordingLocation() throws {
        guard CLLocationManager.locationServicesEnabled() else { throw ShellError.sensorUnavailable("Location services are disabled") }
        guard ["whenInUse", "always"].contains(locationAuthorization()) else { throw ShellError.permissionDenied("Location permission must be granted before recording") }
        recordingLocationActive = true
        locationManager.activityType = .fitness
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 2
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.startUpdatingLocation()
        log.append(subsystem: "recording", message: "Continuous workout location delivery started")
    }

    func stopRecordingLocation() {
        recordingLocationActive = false
        if locationState != "active" { locationManager.stopUpdatingLocation() }
        locationManager.allowsBackgroundLocationUpdates = locationBackgroundActive
        locationManager.showsBackgroundLocationIndicator = locationBackgroundActive
        log.append(subsystem: "recording", message: "Continuous workout location delivery stopped")
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        recordHostEvent?("locationAuthorization", ["authorization": locationAuthorization(), "precise": locationPrecision(), "sourceTimestamp": ISOTime.now()])
        emitEvent?("permissions.updated", [:])
        if ["denied", "restricted"].contains(locationAuthorization()) {
            if locationState == "active" { stopLocationInternally(reason: "Location authorization was lost") }
            if recordingLocationActive { recordingLocationActive = false; manager.stopUpdatingLocation() }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations updates: [CLLocation]) {
        guard locationState == "active" || recordingLocationActive else { return }
        for location in updates.sorted(by: { $0.timestamp < $1.timestamp }) {
            recordRawLocation?([
                "sourceTimestamp": ISO8601DateFormatter().string(from: location.timestamp), "receivedAt": ISOTime.now(),
                "latitudeDegrees": location.coordinate.latitude, "longitudeDegrees": location.coordinate.longitude,
                "horizontalAccuracyM": location.horizontalAccuracy, "altitudeM": location.altitude, "verticalAccuracyM": location.verticalAccuracy,
                "speedMps": location.speed, "speedAccuracyMps": location.speedAccuracy, "courseDegrees": location.course,
                "courseAccuracyDegrees": location.courseAccuracy, "floorLevel": location.floor?.level ?? NSNull(),
                "isSimulatedBySoftware": location.sourceInformation?.isSimulatedBySoftware ?? NSNull(),
                "isProducedByAccessory": location.sourceInformation?.isProducedByAccessory ?? NSNull(),
                "callbackBatchCount": updates.count, "authorization": locationAuthorization()
            ])
            if locationState == "active" { locationReceived += 1 }
            guard location.horizontalAccuracy >= 0,
                  (-90...90).contains(location.coordinate.latitude), (-180...180).contains(location.coordinate.longitude) else {
                if locationState == "active" { locationRejected += 1; locationLastRejection = "Core Location supplied invalid coordinates or negative horizontal accuracy" }
                continue
            }
            if locationState == "active" { locationCursor += 1; locationAccepted += 1 }
            var observation: [String: Any] = [
                "cursor": max(1, locationCursor), "source": "coreLocation",
                "sourceTimestamp": ISO8601DateFormatter().string(from: location.timestamp), "receivedAt": ISOTime.now(),
                "latitudeDegrees": location.coordinate.latitude, "longitudeDegrees": location.coordinate.longitude,
                "horizontalAccuracyM": location.horizontalAccuracy,
                "altitudeM": location.verticalAccuracy >= 0 ? location.altitude : NSNull(),
                "verticalAccuracyM": location.verticalAccuracy >= 0 ? location.verticalAccuracy : NSNull(),
                "speedMps": location.speed >= 0 ? location.speed : NSNull(),
                "speedAccuracyMps": location.speedAccuracy >= 0 ? location.speedAccuracy : NSNull(),
                "courseDegrees": location.course >= 0 ? location.course : NSNull(),
                "courseAccuracyDegrees": location.courseAccuracy >= 0 ? location.courseAccuracy : NSNull(),
                "floorLevel": location.floor?.level ?? NSNull(),
                "isSimulatedBySoftware": location.sourceInformation?.isSimulatedBySoftware ?? NSNull(),
                "isProducedByAccessory": location.sourceInformation?.isProducedByAccessory ?? NSNull()
            ]
            if recordingLocationActive { recordLocation?(observation) }
            if locationState == "active" {
                observation["cursor"] = locationCursor
                locations.append(observation)
                if locations.count > 2048 { locations.removeFirst(locations.count - 2048) }
                locationReason = "Core Location delivered \(locationAccepted) accepted observation\(locationAccepted == 1 ? "" : "s")"
            }
        }
        if locationState == "active" { coalesceLocationEvent() }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        recordHostEvent?("locationError", ["message": error.localizedDescription, "sourceTimestamp": ISOTime.now()])
        locationLastError = String(error.localizedDescription.prefix(2048))
        locationState = "error"; locationReason = "Core Location failed: \(locationLastError!)"
        if !recordingLocationActive { manager.stopUpdatingLocation() }
        locationBackgroundActive = false
        emitEvent?("location.updated", locationStatus())
    }

    func heartRateStatus() -> [String: Any] {
        let authorized = bluetoothAuthorization() == "allowed"
        let available = authorized && (central == nil || central?.state != .unsupported)
        let sortedDevices = devices.values.sorted { ($0["lastSeenAt"] as? String ?? "") > ($1["lastSeenAt"] as? String ?? "") }
        return [
            "availability": available ? "available" : "unavailable", "state": heartRateState,
            "reason": available ? heartRateReason : (authorized ? "Bluetooth is unsupported" : "Bluetooth permission has not been granted"),
            "scanEndsAt": scanEndsAt ?? NSNull(), "devices": Array(sortedDevices.prefix(32)),
            "connectionId": connectionId ?? NSNull(), "connectedDevice": selectedPeripheral.flatMap { devices[$0.identifier] } ?? NSNull(),
            "backgroundModeConfigured": true, "appLifecycle": appLifecycle(), "receivedCount": heartRateReceived,
            "parseErrorCount": parseErrors, "reconnectCount": reconnectCount, "retainedCount": measurements.count,
            "oldestCursor": measurements.first?["cursor"] ?? NSNull(), "latestCursor": measurements.last?["cursor"] ?? NSNull(),
            "latestMeasurement": measurements.last ?? NSNull(), "lastError": heartRateLastError ?? NSNull()
        ]
    }

    func startScan(duration: Int) throws -> [String: Any] {
        guard bluetoothAuthorization() == "allowed" else { throw ShellError.permissionDenied("Bluetooth permission must be granted explicitly before scanning") }
        ensureCentral()
        guard central?.state == .poweredOn else { throw ShellError.sensorUnavailable("Bluetooth radio is not powered on") }
        guard heartRateState != "connecting" && heartRateState != "connected" && heartRateState != "disconnecting" else { throw ShellError.invalidState("Disconnect the current heart-rate device before scanning") }
        stopScanInternal(reason: "Restarting scan")
        let ends = Date().addingTimeInterval(TimeInterval(duration))
        scanEndsAt = ISO8601DateFormatter().string(from: ends)
        heartRateState = "scanning"; heartRateReason = "Scanning for Heart Rate service 180D"
        central?.scanForPeripherals(withServices: [CBUUID(string: "180D")], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        scanTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            self?.stopScanInternal(reason: "Heart-rate scan reached its time limit")
        }
        emitEvent?("heartRate.updated", heartRateStatus())
        return heartRateStatus()
    }

    func stopScan() -> [String: Any] {
        stopScanInternal(reason: "Heart-rate scan stopped explicitly")
        return heartRateStatus()
    }

    func connect(deviceId: String) throws -> [String: Any] {
        guard let uuid = UUID(uuidString: deviceId), let peripheral = peripherals[uuid] else { throw ShellError.invalidRequest("Unknown scanned heart-rate device") }
        guard heartRateState != "connecting" && heartRateState != "connected" && heartRateState != "disconnecting" else { throw ShellError.invalidState("A heart-rate connection is already active") }
        stopScanInternal(reason: "Scan stopped to connect")
        connectionId = "hr-\(UUID().uuidString)"; selectedPeripheral = peripheral; explicitDisconnect = false
        heartRateReceived = 0; parseErrors = 0; reconnectCount = 0; heartRateCursor = 0; measurements.removeAll(keepingCapacity: true); heartRateLastError = nil
        heartRateState = "connecting"; heartRateReason = "Connecting to the selected heart-rate device"
        peripheral.delegate = self; central?.connect(peripheral)
        emitEvent?("heartRate.updated", heartRateStatus())
        return heartRateStatus()
    }

    func disconnect(id: String) throws -> [String: Any] {
        guard id == connectionId else { throw ShellError.invalidState("Connection ID does not match the current heart-rate connection") }
        guard heartRateState != "inactive" else { return heartRateStatus() }
        explicitDisconnect = true; heartRateState = "disconnecting"; heartRateReason = "Disconnecting heart-rate device"
        if let selectedPeripheral { central?.cancelPeripheralConnection(selectedPeripheral) }
        else { finishDisconnect(reason: "Heart-rate connection stopped explicitly") }
        emitEvent?("heartRate.updated", heartRateStatus())
        return heartRateStatus()
    }

    func readHeartRate(id: String, after: Int?, limit: Int) throws -> [String: Any] {
        guard id == connectionId else { throw ShellError.invalidState("Connection ID does not match the retained heart-rate stream") }
        return page(items: measurements, after: after, limit: limit)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn: bluetoothPower = "poweredOn"
        case .poweredOff: bluetoothPower = "poweredOff"; stopScanInternal(reason: "Bluetooth radio is powered off")
        case .unauthorized: bluetoothPower = "unauthorized"
        case .unsupported: bluetoothPower = "unsupported"
        default: bluetoothPower = "unknown"
        }
        recordHostEvent?("bluetoothState", ["power": bluetoothPower, "authorization": bluetoothAuthorization(), "sourceTimestamp": ISOTime.now()])
        emitEvent?("permissions.updated", [:]); emitEvent?("heartRate.updated", heartRateStatus())
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        peripherals[peripheral.identifier] = peripheral
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []).prefix(16).map { $0.uuidString.uppercased() }
        let connectable = (advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue
        devices[peripheral.identifier] = [
            "deviceId": peripheral.identifier.uuidString, "name": peripheral.name ?? NSNull(),
            "rssi": RSSI.intValue == 127 ? NSNull() : max(-127, min(20, RSSI.intValue)), "lastSeenAt": ISOTime.now(),
            "isConnectable": connectable ?? NSNull(), "advertisedServiceUuids": services
        ]
        if devices.count > 32, let oldest = devices.min(by: { ($0.value["lastSeenAt"] as? String ?? "") < ($1.value["lastSeenAt"] as? String ?? "") })?.key {
            devices.removeValue(forKey: oldest); peripherals.removeValue(forKey: oldest)
        }
        coalesceHeartRateEvent()
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        heartRateState = "connecting"; heartRateReason = "Discovering Heart Rate service 180D"
        peripheral.discoverServices([CBUUID(string: "180D")])
        emitEvent?("heartRate.updated", heartRateStatus())
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        heartRateState = "error"; heartRateLastError = error?.localizedDescription ?? "Connection failed"; heartRateReason = "Heart-rate connection failed"
        emitEvent?("heartRate.updated", heartRateStatus())
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, timestamp: CFAbsoluteTime, isReconnecting: Bool, error: (any Error)?) {
        handleDisconnect(central: central, peripheral: peripheral, error: error)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        handleDisconnect(central: central, peripheral: peripheral, error: error)
    }

    private func handleDisconnect(central: CBCentralManager, peripheral: CBPeripheral, error: Error?) {
        recordHostEvent?("heartRateDisconnected", ["deviceId": peripheral.identifier.uuidString, "error": error?.localizedDescription ?? NSNull(), "sourceTimestamp": ISOTime.now()])
        if explicitDisconnect { finishDisconnect(reason: "Heart-rate connection stopped explicitly"); return }
        guard connectionId != nil, reconnectCount < 3, central.state == .poweredOn else {
            heartRateState = "error"; heartRateLastError = error?.localizedDescription ?? "Device disconnected"; heartRateReason = "Heart-rate device disconnected"
            emitEvent?("heartRate.updated", heartRateStatus()); return
        }
        reconnectCount += 1; heartRateState = "connecting"; heartRateReason = "Reconnecting to heart-rate device (attempt \(reconnectCount))"
        central.connect(peripheral); emitEvent?("heartRate.updated", heartRateStatus())
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == CBUUID(string: "180D") }) else { failHeartRate(error?.localizedDescription ?? "Heart Rate service 180D not found"); return }
        peripheral.discoverCharacteristics([CBUUID(string: "2A37")], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil, let characteristic = service.characteristics?.first(where: { $0.uuid == CBUUID(string: "2A37") }) else { failHeartRate(error?.localizedDescription ?? "Heart Rate Measurement 2A37 not found"); return }
        peripheral.setNotifyValue(true, for: characteristic)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, characteristic.isNotifying else { failHeartRate(error?.localizedDescription ?? "Could not subscribe to 2A37"); return }
        heartRateState = "connected"; heartRateReason = "Subscribed to Heart Rate Measurement 2A37"
        emitEvent?("heartRate.updated", heartRateStatus())
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == CBUUID(string: "2A37") else { return }
        let receivedAt = ISOTime.now()
        recordRawHeartRate?([
            "receivedAt": receivedAt, "deviceId": peripheral.identifier.uuidString, "connectionId": connectionId ?? NSNull(),
            "characteristicUuid": characteristic.uuid.uuidString, "rawCharacteristicBase64": characteristic.value?.base64EncodedString() ?? NSNull(),
            "deliveryError": error?.localizedDescription ?? NSNull(), "peripheralState": peripheral.state.rawValue
        ])
        heartRateReceived += 1
        guard error == nil, let data = characteristic.value, let parsed = parseHeartRate(data) else {
            parseErrors += 1; heartRateLastError = error?.localizedDescription ?? "Malformed or truncated 2A37 packet"; coalesceHeartRateEvent(); return
        }
        heartRateCursor += 1
        var measurement = parsed
        measurement["cursor"] = heartRateCursor; measurement["connectionId"] = connectionId!; measurement["deviceId"] = peripheral.identifier.uuidString; measurement["receivedAt"] = receivedAt
        measurements.append(measurement)
        if measurements.count > 2048 { measurements.removeFirst(measurements.count - 2048) }
        heartRateReason = "Received \(measurements.count) retained heart-rate measurement\(measurements.count == 1 ? "" : "s")"
        recordHeartRate?(measurement)
        coalesceHeartRateEvent()
    }

    nonisolated static func parseHeartRatePacket(_ data: Data) -> [String: Any]? {
        guard let flags = data.first else { return nil }
        var offset = 1
        let isUInt16 = flags & 0x01 != 0
        let bpm: Int
        if isUInt16 {
            guard data.count >= offset + 2 else { return nil }
            bpm = Int(data[offset]) | Int(data[offset + 1]) << 8; offset += 2
        } else {
            guard data.count >= offset + 1 else { return nil }
            bpm = Int(data[offset]); offset += 1
        }
        let contact: String
        if flags & 0x04 == 0 { contact = "unsupported" }
        else { contact = flags & 0x02 == 0 ? "notDetected" : "detected" }
        var energy: Any = NSNull()
        if flags & 0x08 != 0 {
            guard data.count >= offset + 2 else { return nil }
            energy = Int(data[offset]) | Int(data[offset + 1]) << 8; offset += 2
        }
        var intervals: [Double] = []
        if flags & 0x10 != 0 {
            guard (data.count - offset).isMultiple(of: 2) else { return nil }
            while offset + 1 < data.count && intervals.count < 32 {
                intervals.append(Double(Int(data[offset]) | Int(data[offset + 1]) << 8) / 1024.0); offset += 2
            }
        } else if offset != data.count { return nil }
        return ["bpm": bpm, "valueFormat": isUInt16 ? "uint16" : "uint8", "sensorContact": contact, "energyExpendedKJ": energy, "rrIntervalsSeconds": intervals, "rawFlags": Int(flags)]
    }

    private func parseHeartRate(_ data: Data) -> [String: Any]? { Self.parseHeartRatePacket(data) }

    private func ensureCentral() {
        if central == nil { central = CBCentralManager(delegate: self, queue: .main, options: [CBCentralManagerOptionShowPowerAlertKey: false]) }
    }

    private func stopLocationInternally(reason: String) {
        locationState = "stopping"; if !recordingLocationActive { locationManager.stopUpdatingLocation() }; locationManager.allowsBackgroundLocationUpdates = recordingLocationActive
        locationManager.showsBackgroundLocationIndicator = false
        locationManager.showsBackgroundLocationIndicator = recordingLocationActive
        locationBackgroundActive = false; locationExpiryTask?.cancel(); locationState = "inactive"; locationReason = reason
        emitEvent?("location.updated", locationStatus())
    }

    private func stopScanInternal(reason: String) {
        central?.stopScan(); scanTask?.cancel(); scanEndsAt = nil
        if heartRateState == "scanning" { heartRateState = "inactive"; heartRateReason = reason; emitEvent?("heartRate.updated", heartRateStatus()) }
    }

    private func finishDisconnect(reason: String) {
        heartRateState = "inactive"; heartRateReason = reason; selectedPeripheral = nil; explicitDisconnect = false
        emitEvent?("heartRate.updated", heartRateStatus())
    }

    private func failHeartRate(_ reason: String) {
        heartRateState = "error"; heartRateLastError = String(reason.prefix(2048)); heartRateReason = "Heart-rate service setup failed"
        emitEvent?("heartRate.updated", heartRateStatus())
    }

    private func page(items: [[String: Any]], after: Int?, limit: Int) -> [String: Any] {
        let oldest = items.first?["cursor"] as? Int
        let dropped = after.map { requested in oldest.map { first in first > requested + 1 } ?? false } ?? false
        let eligible = items.filter { ($0["cursor"] as! Int) > (after ?? 0) }
        let selected = Array(eligible.prefix(limit))
        let next: Any = (selected.last?["cursor"] as? Int).map { $0 as Any } ?? after.map { $0 as Any } ?? NSNull()
        return ["items": selected, "nextCursor": next, "oldestAvailableCursor": oldest ?? NSNull(), "hasMore": eligible.count > selected.count, "droppedBeforeCursor": dropped]
    }

    private func coalesceLocationEvent() {
        let delay = max(0, 1 - Date().timeIntervalSince(lastLocationEvent))
        guard locationEventTask == nil else { return }
        locationEventTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay)); guard !Task.isCancelled, let self else { return }
            self.lastLocationEvent = Date(); self.locationEventTask = nil; self.emitEvent?("location.updated", self.locationStatus())
        }
    }

    private func coalesceHeartRateEvent() {
        let delay = max(0, 0.25 - Date().timeIntervalSince(lastHeartRateEvent))
        guard heartRateEventTask == nil else { return }
        heartRateEventTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay)); guard !Task.isCancelled, let self else { return }
            self.lastHeartRateEvent = Date(); self.heartRateEventTask = nil; self.emitEvent?("heartRate.updated", self.heartRateStatus())
        }
    }

    @objc private func lifecycleChanged() {
        recordHostEvent?("appLifecycle", ["state": appLifecycle(), "sourceTimestamp": ISOTime.now()])
        if appLifecycle() == "background" {
            stopScanInternal(reason: "Heart-rate scan stopped when the app backgrounded")
            if locationBackgroundMode == "foregroundOnly", locationState == "active" { stopLocationInternally(reason: "Foreground-only location probe stopped when the app backgrounded") }
        }
        emitEvent?("location.updated", locationStatus()); emitEvent?("heartRate.updated", heartRateStatus())
    }

    private func locationAuthorization() -> String {
        switch locationManager.authorizationStatus {
        case .notDetermined: "notDetermined"; case .restricted: "restricted"; case .denied: "denied"
        case .authorizedAlways: "always"; case .authorizedWhenInUse: "whenInUse"; @unknown default: "restricted"
        }
    }

    private func locationPrecision() -> Any {
        guard ["whenInUse", "always"].contains(locationAuthorization()) else { return NSNull() }
        return locationManager.accuracyAuthorization == .fullAccuracy
    }

    private func bluetoothAuthorization() -> String {
        switch CBManager.authorization {
        case .notDetermined: "notDetermined"; case .restricted: "restricted"; case .denied: "denied"; case .allowedAlways: "allowed"; @unknown default: "restricted"
        }
    }

    private func permissionReason(name: String, authorization: String) -> String {
        switch authorization {
        case "notDetermined": "\(name) permission has not been requested; use the explicit permission action"
        case "denied": "\(name) permission is denied; change it in iOS Settings"
        case "restricted": "\(name) permission is restricted by the device"
        default: "\(name) permission is granted"
        }
    }

    private func appLifecycle() -> String {
        switch UIApplication.shared.applicationState { case .active: "active"; case .background: "background"; default: "inactive" }
    }
}
