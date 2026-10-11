import Foundation
import Security
import SQLite3

actor SyncStore {
    private struct Snapshot: Codable { var profiles: [ServerProfile] = []; var activeProfileID: UUID?; var runs: [SyncRun] = []; var transfers: [AssetTransfer] = [] }
    private let url: URL
    private let legacyURL: URL
    private var database: SQLiteDatabase?

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PicSync", isDirectory: true)
        url = base.appendingPathComponent("journal.sqlite")
        legacyURL = base.appendingPathComponent("journal.json")
    }

    init(url: URL, legacyURL: URL? = nil) {
        self.url = url
        self.legacyURL = legacyURL ?? url.deletingLastPathComponent().appendingPathComponent("journal.json")
    }

    func load() throws {
        guard database == nil else { return }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let db = try SQLiteDatabase(url: url)
        let version = try db.query("PRAGMA user_version") { sqlite3_column_int($0, 0) }.first ?? 0
        guard version <= 1 else { throw NSError(domain: "PicSync.SQLite", code: 1, userInfo: [NSLocalizedDescriptionKey: "This sync database was created by a newer version of PicSync."]) }
        try db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        try db.execute("CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, payload BLOB NOT NULL)")
        try db.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, payload BLOB NOT NULL, updated INTEGER NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
                completedBytes INTEGER NOT NULL DEFAULT 0)
            """)
        try db.execute("""
            CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY, runID TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                state TEXT NOT NULL, payload BLOB NOT NULL)
            """)
        try db.execute("CREATE INDEX IF NOT EXISTS transfers_queue ON transfers(runID, state, id)")
        try db.execute("CREATE INDEX IF NOT EXISTS transfers_recovery ON transfers(state)")
        try db.execute("CREATE TABLE IF NOT EXISTS paths (runID TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, path TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(runID,path))")
        // Originals never change, so an asset's fingerprint is cached forever; backedUp is the
        // per-destination checklist that lets a repeat sync skip an item without exporting it.
        try db.execute("CREATE TABLE IF NOT EXISTS fingerprints (identifier TEXT PRIMARY KEY, fingerprint TEXT NOT NULL) WITHOUT ROWID")
        try db.execute("CREATE TABLE IF NOT EXISTS backedUp (destination TEXT NOT NULL, identifier TEXT NOT NULL, PRIMARY KEY(destination, identifier)) WITHOUT ROWID")
        try db.execute("CREATE TABLE IF NOT EXISTS albumLinks (destination TEXT NOT NULL, identifier TEXT NOT NULL, album TEXT NOT NULL, PRIMARY KEY(destination, identifier, album)) WITHOUT ROWID")
        database = db
        do {
            try db.transaction {
                try db.execute("PRAGMA user_version=1")
                let migrated = try db.query("SELECT value FROM settings WHERE key='legacyMigrated'") { _ in true }.first ?? false
                if !migrated {
                    if FileManager.default.fileExists(atPath: legacyURL.path) {
                        let snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: legacyURL))
                        for profile in snapshot.profiles { try save(profile: profile) }
                        for run in snapshot.runs { try putRun(run) }
                        for transfer in snapshot.transfers { try putTransfer(transfer) }
                        if let id = snapshot.activeProfileID { try selectProfile(id) }
                    }
                    try db.execute("INSERT INTO settings VALUES ('legacyMigrated', '1')")
                }
            }
            // The legacy JSON is retained untouched. Migration and its marker commit together.
            try recoverInterruptedRuns()
            try db.transaction {
                let seeded = try db.query("SELECT value FROM settings WHERE key='ledgerSeeded'") { _ in true }.first ?? false
                if !seeded {
                    try seedLedger()
                    try db.execute("INSERT INTO settings VALUES ('ledgerSeeded', '1')")
                }
            }
        } catch {
            database = nil
            throw error
        }
    }

    private func db() throws -> SQLiteDatabase {
        guard let database else { throw CocoaError(.fileReadUnknown) }
        return database
    }

    func profiles() throws -> [ServerProfile] {
        try db().query("SELECT payload FROM profiles") { try SQLiteDatabase.decode(ServerProfile.self, from: $0) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }
    func activeProfileID() throws -> UUID? {
        try db().query("SELECT value FROM settings WHERE key='activeProfile'") { UUID(uuidString: String(cString: sqlite3_column_text($0, 0))) }.first ?? nil
    }
    private func readRun(_ row: OpaquePointer) throws -> SyncRun {
        var run = try SQLiteDatabase.decode(SyncRun.self, from: row)
        run.completedCount = Int(sqlite3_column_int64(row, 1))
        run.skippedCount = Int(sqlite3_column_int64(row, 2))
        run.failedCount = Int(sqlite3_column_int64(row, 3))
        run.totalBytes = sqlite3_column_int64(row, 4)
        run.completedBytes = sqlite3_column_int64(row, 5)
        run.updatedAt = Date(timeIntervalSince1970: Double(sqlite3_column_int64(row, 6)) / 1000)
        return run
    }
    private let runColumns = "payload, completed, skipped, failed, bytes, completedBytes, updated"
    func runs() throws -> [SyncRun] { try db().query("SELECT \(runColumns) FROM runs ORDER BY updated DESC", map: readRun) }
    func run(_ id: UUID) throws -> SyncRun? { try db().query("SELECT \(runColumns) FROM runs WHERE id=?", [.text(id.uuidString)], map: readRun).first }
    func transfers(for runID: UUID, state: AssetTransferState? = nil, limit: Int = 100, after: String = "") throws -> [AssetTransfer] {
        var values: [SQLiteDatabase.Value] = [.text(runID.uuidString), .text(after)]
        if let state { values.append(.text(state.rawValue)) }
        values.append(.integer(Int64(limit)))
        return try db().query("SELECT payload FROM transfers WHERE runID=? AND id>? \(state == nil ? "" : "AND state=?") ORDER BY id LIMIT ?", values) { try SQLiteDatabase.decode(AssetTransfer.self, from: $0) }
    }
    func hasPending(_ runID: UUID) throws -> Bool {
        try db().query("SELECT 1 FROM transfers WHERE runID=? AND state IN ('queued','queuedCloud','staged','exporting','deduplicating','uploading','committing','indexing') LIMIT 1", [.text(runID.uuidString)]) { _ in true }.first ?? false
    }
    func transfer(_ id: UUID) throws -> AssetTransfer? {
        try db().query("SELECT payload FROM transfers WHERE id=?", [.text(id.uuidString)]) { try SQLiteDatabase.decode(AssetTransfer.self, from: $0) }.first
    }
    func reservePath(_ path: String, runID: UUID) throws -> Bool {
        try db().transaction {
            let values: [SQLiteDatabase.Value] = [.text(runID.uuidString), .text(path.precomposedStringWithCanonicalMapping.lowercased())]
            if try db().query("SELECT 1 FROM paths WHERE runID=? AND path=?", values, map: { _ in true }).first == true { return false }
            try db().execute("INSERT INTO paths VALUES (?,?)", values)
            return true
        }
    }
    /// Claim and persist together, so workers never hold a stale whole-run queue.
    /// The download pool's queue: originals a worker found to be in iCloud only.
    func claimCloud(_ runID: UUID) throws -> AssetTransfer? {
        try db().transaction {
            guard var transfer = try transfers(for: runID, state: .queuedCloud, limit: 1).first else { return nil }
            transfer.state = .exporting
            try putTransfer(transfer)
            return transfer
        }
    }
    /// Whether any item could still turn out to need an iCloud download.
    func hasUnclassified(_ runID: UUID) throws -> Bool {
        try db().query("SELECT 1 FROM transfers WHERE runID=? AND state IN ('queued','exporting') LIMIT 1", [.text(runID.uuidString)]) { _ in true }.first ?? false
    }
    func cloudQueueCount(_ runID: UUID) throws -> Int {
        try db().query("SELECT COUNT(*) FROM transfers WHERE runID=? AND state='queuedCloud'", [.text(runID.uuidString)]) { Int(sqlite3_column_int64($0, 0)) }.first ?? 0
    }
    func claimNext(_ runID: UUID) throws -> AssetTransfer? {
        try db().transaction {
            // Separate equality lookups avoid sorting all queued rows on every claim.
            let staged = try transfers(for: runID, state: .staged, limit: 1).first
            guard var transfer = try staged ?? transfers(for: runID, state: .queued, limit: 1).first else { return nil }
            transfer.state = transfer.state == .staged ? .deduplicating : .exporting
            try putTransfer(transfer)
            return transfer
        }
    }

    func save(profile: ServerProfile) throws {
        try db().execute("INSERT INTO profiles VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", [.text(profile.id.uuidString), .blob(try JSONEncoder().encode(profile))])
    }
    func selectProfile(_ id: UUID) throws {
        guard try profiles().contains(where: { $0.id == id }) else { return }
        try db().execute("INSERT INTO settings VALUES ('activeProfile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [.text(id.uuidString)])
    }
    /// `alreadyBackedUp` counts selected items which got no transfer row because the checklist covers them.
    func save(run: SyncRun, transfers: [AssetTransfer]? = nil, alreadyBackedUp: Int = 0) throws {
        try db().transaction {
            try putRun(run)
            if let transfers { for transfer in transfers { try putTransfer(transfer) } }
            if alreadyBackedUp > 0 {
                try db().execute("UPDATE runs SET skipped=skipped+? WHERE id=?", [.integer(Int64(alreadyBackedUp)), .text(run.id.uuidString)])
            }
        }
    }

    func backedUpIdentifiers(destination: String) throws -> Set<String> {
        Set(try db().query("SELECT identifier FROM backedUp WHERE destination=?", [.text(destination)]) { String(cString: sqlite3_column_text($0, 0)) })
    }
    func knownFingerprint(_ identifier: String) throws -> String? {
        try db().query("SELECT fingerprint FROM fingerprints WHERE identifier=?", [.text(identifier)]) { String(cString: sqlite3_column_text($0, 0)) }.first
    }
    func recordFingerprint(_ fingerprint: String, identifier: String) throws {
        try db().execute("INSERT INTO fingerprints VALUES (?,?) ON CONFLICT(identifier) DO UPDATE SET fingerprint=excluded.fingerprint", [.text(identifier), .text(fingerprint)])
    }
    func markBackedUp(_ identifier: String, destination: String) throws {
        try db().execute("INSERT OR IGNORE INTO backedUp VALUES (?,?)", [.text(destination), .text(identifier)])
    }
    /// Album folders each identifier is already linked into, for one album root on one share.
    func linkedAlbums(destination: String) throws -> [String: Set<String>] {
        var linked = [String: Set<String>]()
        let rows = try db().query("SELECT identifier, album FROM albumLinks WHERE destination=?", [.text(destination)]) {
            (String(cString: sqlite3_column_text($0, 0)), String(cString: sqlite3_column_text($0, 1)))
        }
        for (identifier, album) in rows { linked[identifier, default: []].insert(album) }
        return linked
    }
    func markLinked(_ identifier: String, album: String, destination: String) throws {
        try db().execute("INSERT OR IGNORE INTO albumLinks VALUES (?,?,?)", [.text(destination), .text(identifier), .text(album)])
    }
    /// One-time: runs finished before the checklist existed still count.
    private func seedLedger() throws {
        let destinations = Dictionary(try profiles().map { ($0.id, $0.ledgerDestination) }, uniquingKeysWith: { first, _ in first })
        for run in try runs() {
            for state in [AssetTransferState.completed, .skippedDuplicate] {
                var after = ""
                while true {
                    let batch = try transfers(for: run.id, state: state, limit: 500, after: after)
                    guard let last = batch.last else { break }
                    after = last.id.uuidString
                    for transfer in batch {
                        guard let fingerprint = transfer.fingerprint else { continue }
                        try recordFingerprint(fingerprint, identifier: transfer.localIdentifier)
                        if let destination = destinations[run.profileID] { try markBackedUp(transfer.localIdentifier, destination: destination) }
                    }
                }
            }
        }
    }
    private func putRun(_ original: SyncRun) throws {
        var run = original
        run.selectedCount = run.itemCount
        run.assetIdentifiers = [] // Identifiers live once, in transfer rows, not in every run update.
        try db().execute("INSERT INTO runs (id,payload,updated) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated=excluded.updated", [.text(run.id.uuidString), .blob(try JSONEncoder().encode(run)), .integer(Int64(run.updatedAt.timeIntervalSince1970 * 1000))])
    }
    func save(transfer: AssetTransfer) throws { try db().transaction { try putTransfer(transfer) } }
    private func putTransfer(_ transfer: AssetTransfer) throws {
        let previous = try db().query("SELECT payload FROM transfers WHERE id=?", [.text(transfer.id.uuidString)]) { try SQLiteDatabase.decode(AssetTransfer.self, from: $0) }.first
        let old = contribution(previous), new = contribution(transfer)
        try db().execute("INSERT INTO transfers VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, payload=excluded.payload", [.text(transfer.id.uuidString), .text(transfer.runID.uuidString), .text(transfer.state.rawValue), .blob(try JSONEncoder().encode(transfer))])
        for path in transfer.manifest.compactMap(\.finalPath) {
            try db().execute("INSERT OR IGNORE INTO paths VALUES (?,?)", [.text(transfer.runID.uuidString), .text(path.precomposedStringWithCanonicalMapping.lowercased())])
        }
        try db().execute("UPDATE runs SET completed=completed+?, skipped=skipped+?, failed=failed+?, bytes=bytes+?, completedBytes=completedBytes+?, updated=? WHERE id=?", zip(new, old).map { .integer($0 - $1) } + [.integer(Int64(Date().timeIntervalSince1970 * 1000)), .text(transfer.runID.uuidString)])
    }
    private func contribution(_ transfer: AssetTransfer?) -> [Int64] {
        guard let transfer else { return [0,0,0,0,0] }
        let bytes = transfer.manifest.reduce(Int64(0)) { $0 + $1.byteCount }
        return [transfer.state == .completed ? 1 : 0, transfer.state == .skippedDuplicate ? 1 : 0, transfer.state == .failed ? 1 : 0, bytes, [.completed, .skippedDuplicate].contains(transfer.state) ? bytes : 0]
    }
    func deleteRun(_ runID: UUID) throws {
        try db().execute("DELETE FROM runs WHERE id=?", [.text(runID.uuidString)])
    }
    func setActiveWorkerCount(_ count: Int, for runID: UUID) throws {
        guard var run = try run(runID) else { return }
        run.activeWorkerCount = count
        run.updatedAt = Date()
        try save(run: run)
    }
    func requeueFailedTransfers(for runID: UUID) throws -> Int {
        var count = 0
        // Bounded batches: restarting a large failed run does not decode the whole journal.
        while true {
            let batch = try transfers(for: runID, state: .failed)
            if batch.isEmpty { break }
            try db().transaction {
                for var transfer in batch {
                    transfer.state = transfer.requeuedState
                    transfer.errorMessage = nil
                    transfer.updatedAt = Date()
                    try putTransfer(transfer)
                    count += 1
                }
            }
        }
        return count
    }

    func recoverClaims(for runID: UUID) throws {
        while true {
            let batch = try db().query("SELECT payload FROM transfers WHERE runID=? AND state IN ('exporting','deduplicating','uploading','committing','indexing') LIMIT 100", [.text(runID.uuidString)]) { try SQLiteDatabase.decode(AssetTransfer.self, from: $0) }
            if batch.isEmpty { break }
            try db().transaction {
                for var transfer in batch {
                    transfer.state = transfer.requeuedState
                    try putTransfer(transfer)
                }
            }
        }
    }

    private func recoverInterruptedRuns() throws {
        try db().transaction {
            for var run in try runs() {
                run.activeWorkerCount = 0
                if [.running, .pausing].contains(run.state) { run.state = .paused }
                try putRun(run)
            }
            while true {
                let batch = try db().query("SELECT payload FROM transfers WHERE state IN ('exporting','deduplicating','uploading','committing','indexing') LIMIT 100") { try SQLiteDatabase.decode(AssetTransfer.self, from: $0) }
                if batch.isEmpty { break }
                for var transfer in batch {
                    // Hash validation happens lazily in the worker, not during app startup.
                    transfer.state = transfer.requeuedState
                    try putTransfer(transfer)
                }
            }
        }
    }
    static func hasValidStaging(_ manifest: [ResourceManifest], runtime: TransferRuntime) async throws -> Bool {
        guard !manifest.isEmpty else { return false }
        for resource in manifest {
            try runtime.check()
            guard let size = try? URL(fileURLWithPath: resource.stagingPath).resourceValues(forKeys: [.fileSizeKey]).fileSize else { return false }
            guard Int64(size) == resource.byteCount else { return false }
            guard (try? await ContentHasher.hashAsync(file: URL(fileURLWithPath: resource.stagingPath), check: { try runtime.check() })) == resource.sha256 else {
                try runtime.check()
                return false
            }
        }
        return true
    }
}

enum CredentialStore {
    static func save(_ password: String, profileID: UUID) throws {
        let account = profileID.uuidString
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: "com.example.picsync.smb", kSecAttrAccount: account] as CFDictionary)
        let status = SecItemAdd([kSecClass: kSecClassGenericPassword, kSecAttrService: "com.example.picsync.smb", kSecAttrAccount: account, kSecValueData: Data(password.utf8), kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly] as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
    static func password(profileID: UUID) throws -> String? {
        var item: CFTypeRef?
        let status = SecItemCopyMatching([kSecClass: kSecClassGenericPassword, kSecAttrService: "com.example.picsync.smb", kSecAttrAccount: profileID.uuidString, kSecReturnData: true] as CFDictionary, &item)
        guard status != errSecItemNotFound else { return nil }; guard status == errSecSuccess, let data = item as? Data else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }; return String(data: data, encoding: .utf8)
    }
}
