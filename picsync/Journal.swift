import Foundation
import Security

actor SyncStore {
    private struct Snapshot: Codable { var profiles: [ServerProfile] = []; var runs: [SyncRun] = []; var transfers: [AssetTransfer] = [] }
    private let url: URL
    private var snapshot = Snapshot()

    init() {
        let fileManager = FileManager.default
        let base = try! fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("PicSync", isDirectory: true)
        try! fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        url = base.appendingPathComponent("journal.json")
    }

    func load() throws { if FileManager.default.fileExists(atPath: url.path) { snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url)) }; recoverInterruptedRuns(); try save() }
    func profiles() -> [ServerProfile] { snapshot.profiles.sorted { $0.updatedAt > $1.updatedAt } }
    func runs() -> [SyncRun] { snapshot.runs.sorted { $0.updatedAt > $1.updatedAt } }
    func run(_ id: UUID) -> SyncRun? { snapshot.runs.first { $0.id == id } }
    func transfers(for runID: UUID) -> [AssetTransfer] { snapshot.transfers.filter { $0.runID == runID } }

    func save(profile: ServerProfile) throws { snapshot.profiles.removeAll { $0.id == profile.id }; snapshot.profiles.append(profile); try save() }
    func save(run: SyncRun, transfers: [AssetTransfer]? = nil) throws { snapshot.runs.removeAll { $0.id == run.id }; snapshot.runs.append(run); if let transfers { snapshot.transfers.removeAll { $0.runID == run.id }; snapshot.transfers.append(contentsOf: transfers) }; try save() }
    func save(transfer: AssetTransfer) throws { snapshot.transfers.removeAll { $0.id == transfer.id }; snapshot.transfers.append(transfer); try save() }
    func requeueFailedTransfers(for runID: UUID) throws -> Int {
        var count = 0
        for index in snapshot.transfers.indices where snapshot.transfers[index].runID == runID && snapshot.transfers[index].state == .failed {
            snapshot.transfers[index].state = .queued
            snapshot.transfers[index].errorMessage = nil
            snapshot.transfers[index].updatedAt = Date()
            count += 1
        }
        if count > 0 { try save() }
        return count
    }

    private func recoverInterruptedRuns() {
        for index in snapshot.runs.indices where [.running, .pausing].contains(snapshot.runs[index].state) { snapshot.runs[index].state = .paused; snapshot.runs[index].updatedAt = Date() }
        for index in snapshot.transfers.indices where [.exporting, .uploading].contains(snapshot.transfers[index].state) { snapshot.transfers[index].state = .queued; snapshot.transfers[index].updatedAt = Date() }
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
