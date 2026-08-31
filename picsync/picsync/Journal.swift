import Foundation
import Security

actor SyncStore {
    private struct Snapshot: Codable { var profiles: [ServerProfile] = []; var activeProfileID: UUID?; var runs: [SyncRun] = []; var transfers: [AssetTransfer] = [] }
    private let url: URL
    private var snapshot = Snapshot()

    init() {
        let fileManager = FileManager.default
        let base = try! fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("PicSync", isDirectory: true)
        try! fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        url = base.appendingPathComponent("journal.json")
    }

    init(url: URL) { self.url = url }

    func load() throws { if FileManager.default.fileExists(atPath: url.path) { snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url)) }; recoverInterruptedRuns(); try save() }
    func profiles() -> [ServerProfile] { snapshot.profiles.sorted { $0.updatedAt > $1.updatedAt } }
    func activeProfileID() -> UUID? { snapshot.activeProfileID }
    func runs() -> [SyncRun] { snapshot.runs.sorted { $0.updatedAt > $1.updatedAt } }
    func run(_ id: UUID) -> SyncRun? { snapshot.runs.first { $0.id == id } }
    func transfers(for runID: UUID) -> [AssetTransfer] { snapshot.transfers.filter { $0.runID == runID } }

    func save(profile: ServerProfile) throws { snapshot.profiles.removeAll { $0.id == profile.id }; snapshot.profiles.append(profile); try save() }
    func selectProfile(_ id: UUID) throws {
        guard snapshot.profiles.contains(where: { $0.id == id }) else { return }
        snapshot.activeProfileID = id
        try save()
    }
    func save(run: SyncRun, transfers: [AssetTransfer]? = nil) throws { snapshot.runs.removeAll { $0.id == run.id }; snapshot.runs.append(run); if let transfers { snapshot.transfers.removeAll { $0.runID == run.id }; snapshot.transfers.append(contentsOf: transfers) }; try save() }
    func save(transfer: AssetTransfer) throws { snapshot.transfers.removeAll { $0.id == transfer.id }; snapshot.transfers.append(transfer); try save() }
    func deleteRun(_ runID: UUID) throws {
        snapshot.runs.removeAll { $0.id == runID }
        snapshot.transfers.removeAll { $0.runID == runID }
        try save()
    }
    func setActiveWorkerCount(_ count: Int, for runID: UUID) throws {
        guard let index = snapshot.runs.firstIndex(where: { $0.id == runID }) else { return }
        snapshot.runs[index].activeWorkerCount = count
        snapshot.runs[index].updatedAt = Date()
        try save()
    }
    func requeueFailedTransfers(for runID: UUID) throws -> Int {
        var count = 0
        for index in snapshot.transfers.indices where snapshot.transfers[index].runID == runID && snapshot.transfers[index].state == .failed {
            let manifest = snapshot.transfers[index].manifest
            snapshot.transfers[index].state = Self.hasValidStaging(manifest) ? .staged : .queued
            snapshot.transfers[index].errorMessage = nil
            snapshot.transfers[index].updatedAt = Date()
            count += 1
        }
        if count > 0 { try save() }
        return count
    }

    private func recoverInterruptedRuns() {
        for index in snapshot.runs.indices {
            snapshot.runs[index].activeWorkerCount = 0
            if [.running, .pausing].contains(snapshot.runs[index].state) {
                snapshot.runs[index].state = .paused
                snapshot.runs[index].updatedAt = Date()
            }
        }
        for index in snapshot.transfers.indices where [.exporting, .deduplicating, .uploading, .committing, .indexing].contains(snapshot.transfers[index].state) {
            let manifest = snapshot.transfers[index].manifest
            snapshot.transfers[index].state = Self.hasValidStaging(manifest) ? .staged : .queued
            snapshot.transfers[index].updatedAt = Date()
        }
    }
    private static func hasValidStaging(_ manifest: [ResourceManifest]) -> Bool {
        !manifest.isEmpty && manifest.allSatisfy { resource in
            guard let size = try? URL(fileURLWithPath: resource.stagingPath).resourceValues(forKeys: [.fileSizeKey]).fileSize else { return false }
            guard Int64(size) == resource.byteCount else { return false }
            return (try? ContentHasher.hash(file: URL(fileURLWithPath: resource.stagingPath))) == resource.sha256
        }
    }
    private func save() throws { try JSONEncoder().encode(snapshot).write(to: url, options: .atomic) }
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
