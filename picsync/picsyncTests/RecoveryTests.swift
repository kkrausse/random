import CryptoKit
import Foundation
import Testing
@testable import picsync

struct RecoveryTests {
    @Test func migrationRetainsTransfersAndDoesNotReplayAfterReopen() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let run = fixture.run(count: 3)
        var completed = fixture.transfer(run, identifier: "completed")
        completed.state = .completed
        completed.manifest = [fixture.resource(bytes: Data("abc".utf8))]
        var interrupted = fixture.transfer(run, identifier: "interrupted")
        interrupted.state = .uploading
        let queued = fixture.transfer(run, identifier: "queued")
        struct Legacy: Codable { let profiles: [ServerProfile]; let runs: [SyncRun]; let transfers: [AssetTransfer] }
        let legacy = fixture.root.appendingPathComponent("journal.json")
        let bytes = try JSONEncoder().encode(Legacy(profiles: [fixture.profile], runs: [run], transfers: [completed, interrupted, queued]))
        try bytes.write(to: legacy)
        try await fixture.store.load()
        #expect(try await fixture.store.run(run.id)?.completedCount == 1)
        #expect(try await fixture.store.run(run.id)?.completedBytes == 3)
        #expect(try await fixture.store.run(run.id)?.itemCount == 3)
        #expect(try await fixture.store.transfer(interrupted.id)?.state == .queued)
        try await fixture.store.deleteRun(run.id)
        let reopened = SyncStore(url: fixture.databaseURL)
        try await reopened.load()
        #expect(try await reopened.run(run.id) == nil)
        #expect(try Data(contentsOf: legacy) == bytes)
    }

    @Test func malformedMigrationRollsBackAndCanBeRetried() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let legacy = fixture.root.appendingPathComponent("journal.json")
        try Data("broken".utf8).write(to: legacy)
        await #expect(throws: (any Error).self) { try await fixture.store.load() }
        try Data("{\"profiles\":[],\"runs\":[],\"transfers\":[]}".utf8).write(to: legacy)
        try await fixture.store.load()
        #expect(try await fixture.store.runs().isEmpty == true)
    }

    @Test func countersCommitWithTransfersAndRecoverWithoutDoubleCounting() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let run = fixture.run(count: 1)
        var transfer = fixture.transfer(run)
        try await fixture.store.save(run: run, transfers: [transfer])
        transfer.manifest = [fixture.resource(bytes: Data("abc".utf8))]
        transfer.state = .completed
        try await fixture.store.save(transfer: transfer)
        try await fixture.store.save(transfer: transfer)
        // A stale run metadata write must not replace transactional counters.
        try await fixture.store.save(run: run)
        #expect(try await fixture.store.run(run.id)?.completedCount == 1)
        #expect(try await fixture.store.run(run.id)?.totalBytes == 3)
        transfer.state = .failed
        try await fixture.store.save(transfer: transfer)
        #expect(try await fixture.store.run(run.id)?.completedBytes == 0)
        #expect(try await fixture.store.run(run.id)?.failedCount == 1)
        let reopened = SyncStore(url: fixture.databaseURL)
        try await reopened.load()
        #expect(try await reopened.requeueFailedTransfers(for: run.id) == 1)
        #expect(try await reopened.run(run.id)?.failedCount == 0)
        #expect(try await reopened.run(run.id)?.totalBytes == 3)
    }

    @Test func partiallyUploadedVideoResumesAfterCheckingPrefix() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote(mode: .interruptUpload)
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: ["video"], profile: fixture.profile, destinationPath: "Photos", parallelism: 1)
        try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
        #expect(try await fixture.store.run(run.id)?.state == .completed)
        #expect(await remote.mediaOffsets == [0, 3])
        #expect(await remote.files["Photos/IMG_0001.jpg"] == Data("original-video".utf8))
        #expect(await remote.hashCalls > 0)
    }

    @Test func corruptPartialIsRestartedRatherThanAppended() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote(mode: .corruptPartial)
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: ["video"], profile: fixture.profile, destinationPath: "Photos", parallelism: 1)
        try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
        #expect(try await fixture.store.run(run.id)?.state == .completed)
        #expect(await remote.mediaOffsets == [0, 0])
        #expect(await remote.files["Photos/IMG_0001.jpg"] == Data("original-video".utf8))
    }

    @Test(arguments: [AssetTransferState.exporting, .deduplicating, .uploading, .committing, .indexing])
    func interruptedClaimsRecoverWithManifestAndPathsIntact(state: AssetTransferState) async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let run = fixture.run(count: 1)
        var transfer = fixture.transfer(run)
        transfer.state = state
        var resource = fixture.resource(bytes: Data("abc".utf8))
        resource.finalPath = "Photos/IMG_0001.jpg"; resource.temporaryPath = "Photos/.owned.partial"
        transfer.manifest = [resource]
        transfer.fingerprint = ContentHasher.assetFingerprint(transfer.manifest)
        try await fixture.store.save(run: run, transfers: [transfer])
        let reopened = SyncStore(url: fixture.databaseURL)
        try await reopened.load()
        let recovered = try #require(try await reopened.transfer(transfer.id))
        #expect(recovered.state == .staged)
        #expect(recovered.manifest == transfer.manifest)
        #expect(recovered.fingerprint == transfer.fingerprint)
        #expect(try await reopened.run(run.id)?.state == .paused)
        #expect(try await reopened.reservePath("photos/img_0001.JPG", runID: run.id) == false)
    }

    @Test func duplicateContentAcrossRunsUsesRemoteManifest() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote()
        let coordinator = fixture.coordinator(remote)
        for index in 0..<2 {
            let run = try await coordinator.createRun(itemIdentifiers: ["photo"], profile: fixture.profile, destinationPath: "Album\(index)", parallelism: 1)
            try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
            #expect(try await fixture.store.run(run.id)?.skippedCount == index)
        }
        #expect(await remote.mediaOffsets.count == 1)
    }

    @Test func sameSizeForeignFinalIsPreservedOnRecovery() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote()
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: ["photo"], profile: fixture.profile, destinationPath: "Photos", parallelism: 1)
        var transfer = try #require(try await fixture.store.transfers(for: run.id).first)
        let data = Data("original-photo".utf8)
        let directory = fixture.stagingRoot.appendingPathComponent(run.id.uuidString).appendingPathComponent(transfer.id.uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("original")
        try data.write(to: file)
        var resource = fixture.resource(bytes: data)
        resource.stagingPath = file.path
        resource.finalPath = "Photos/IMG_0001.jpg"
        resource.temporaryPath = "Photos/.owned.partial"
        transfer.manifest = [resource]; transfer.state = .staged
        transfer.fingerprint = ContentHasher.assetFingerprint(transfer.manifest)
        try await fixture.store.save(transfer: transfer)
        let foreign = Data(repeating: 0x78, count: data.count)
        await remote.put(foreign, at: "Photos/IMG_0001.jpg")
        try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
        #expect(try await fixture.store.run(run.id)?.state == .completed)
        #expect(await remote.files["Photos/IMG_0001.jpg"] == foreign)
        let result = try #require(try await fixture.store.transfer(transfer.id))
        #expect(result.manifest[0].finalPath != resource.finalPath)
        #expect(await remote.files[result.manifest[0].finalPath!] == data)
    }

    @Test func renameAcknowledgementLossDoesNotDuplicateMedia() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote(mode: .loseRenameAcknowledgement)
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: ["live"], profile: fixture.profile, destinationPath: "Photos", parallelism: 1)
        try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
        #expect(try await fixture.store.run(run.id)?.failedCount == 1)
        // Simulate relaunch after a publish checkpoint, including both Live Photo resources.
        let reopened = SyncStore(url: fixture.databaseURL)
        try await reopened.load()
        let recovered = fixture.coordinator(remote, store: reopened)
        try await recovered.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
        #expect(try await reopened.run(run.id)?.state == .completed)
        #expect(await remote.mediaOffsets.count == 2)
        #expect(await remote.files.keys.filter { $0.hasPrefix("Photos/") && !$0.contains("partial") }.count == 2)
    }

    @Test func destinationFullPausesWithoutFailingOrExportingEntireQueue() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote(mode: .diskFull)
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: (0..<100).map(String.init), profile: fixture.profile, destinationPath: "Photos", parallelism: 1)
        try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
        let result = try #require(try await fixture.store.run(run.id))
        #expect(result.state == .paused)
        #expect(result.pauseReason != nil)
        #expect(result.failedCount == 1)
        #expect(try await fixture.store.transfers(for: run.id, state: .queued).count == 99)
        #expect(await remote.mediaOffsets.count == 1)
    }

    @Test func workerConnectionFailureLeavesUnclaimedItemsQueued() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote(mode: .workerConnectionFailure)
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: (0..<20).map(String.init), profile: fixture.profile, destinationPath: "Photos", parallelism: 4)
        try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 4)
        #expect(try await fixture.store.run(run.id)?.state == .paused)
        #expect(try await fixture.store.run(run.id)?.failedCount == 0)
        #expect(try await fixture.store.transfers(for: run.id, state: .queued).count >= 16)
    }

    @Test func pauseDuringUploadCheckpointsAndResumeFinishes() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote(mode: .blockUpload)
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: ["photo"], profile: fixture.profile, destinationPath: "Photos", parallelism: 1)
        let task = Task { try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1) }
        await remote.waitForBlockedUpload()
        try await coordinator.pause(run.id)
        await remote.releaseUpload()
        try await task.value
        #expect(try await fixture.store.run(run.id)?.state == .paused)
        #expect(try await fixture.store.run(run.id)?.failedCount == 0)
        #expect(try await fixture.store.transfers(for: run.id, state: .staged).count == 1)
        try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 1)
        #expect(try await fixture.store.run(run.id)?.state == .completed)
    }

    @Test func stagingBudgetIncludesRetainedFilesAndPreservesReserve() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let retained = fixture.stagingRoot.appendingPathComponent("failed")
        try FileManager.default.createDirectory(at: retained, withIntermediateDirectories: true)
        try Data(repeating: 0, count: 80).write(to: retained.appendingPathComponent("file"))
        let budget = try StagingBudget(root: fixture.stagingRoot, limit: 100, available: { Int64.max })
        #expect(throws: TransferError.self) { try budget.reserve(21) }
        try budget.reserve(20)
        try budget.remove(retained)
        try budget.reserve(80)
        #expect(throws: TransferError.self) { try budget.reserve(1) }
        let lowSpace = try StagingBudget(root: fixture.stagingRoot, limit: 100, available: { StagingBudget.reserveBytes + 5 })
        #expect(throws: TransferError.self) { try lowSpace.reserve(6) }
    }

    @Test func concurrentUploadsDrainBeforeNextExportExceedsBudget() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let remote = MemoryRemote(mode: .blockUpload)
        let coordinator = fixture.coordinator(remote)
        let run = try await coordinator.createRun(itemIdentifiers: ["first", "second"], profile: fixture.profile, destinationPath: "Photos", parallelism: 2)
        let task = Task { try await coordinator.run(run.id, profile: fixture.profile, password: "test", parallelism: 2, stagingLimit: 20) }
        await remote.waitForBlockedUpload()
        await remote.releaseUpload()
        try await task.value
        #expect(try await fixture.store.run(run.id)?.completedCount == 2)
        #expect(try await fixture.store.run(run.id)?.state == .completed)
    }

    @Test func sixtyThousandAssetsUseSmallRunMetadataAndIndexedUpdates() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try await fixture.store.load()
        let run = fixture.run(count: 60_000)
        let transfers = (0..<60_000).map { fixture.transfer(run, identifier: String($0)) }
        let start = Date()
        try await fixture.store.save(run: run, transfers: transfers)
        let inserted = Date()
        for _ in 0..<1_000 {
            var transfer = try #require(try await fixture.store.claimNext(run.id))
            transfer.state = .completed
            try await fixture.store.save(transfer: transfer)
        }
        let summary = try #require(try await fixture.store.run(run.id))
        #expect(summary.itemCount == 60_000)
        #expect(summary.completedCount == 1_000)
        #expect(summary.assetIdentifiers.isEmpty)
        #expect(try JSONEncoder().encode(summary).count < 2_000)
        #expect(try await fixture.store.transfers(for: run.id, state: .queued, limit: 5).count == 5)
        print("SQLite 60k benchmark: insert=\(inserted.timeIntervalSince(start))s; 1,000 claims+completions=\(Date().timeIntervalSince(inserted))s")
    }
}

private struct Fixture: Sendable {
    let root: URL
    let store: SyncStore
    var databaseURL: URL { root.appendingPathComponent("journal.sqlite") }
    var stagingRoot: URL { root.appendingPathComponent("Transfers") }
    let profile = ServerProfile(id: UUID(), displayName: "Test", host: "test", port: 445, username: "test", domain: nil, share: "Photos", requiresSigning: false, createdAt: Date(), updatedAt: Date())
    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        store = SyncStore(url: root.appendingPathComponent("journal.sqlite"))
    }
    func remove() { try? FileManager.default.removeItem(at: root) }
    func run(count: Int) -> SyncRun {
        SyncRun(id: UUID(), sourceLabel: "Test", assetIdentifiers: (0..<count).map(String.init), profileID: profile.id, share: profile.share, destinationPath: "Photos", parallelism: 1, activeWorkerCount: 0, state: .running, createdAt: Date(), updatedAt: Date(), completedBytes: 0, totalBytes: 0, completedCount: 0, skippedCount: 0, failedCount: 0)
    }
    func transfer(_ run: SyncRun, identifier: String = "photo") -> AssetTransfer {
        AssetTransfer(id: UUID(), runID: run.id, localIdentifier: identifier, state: .queued, manifest: [], fingerprint: nil, attempts: 0, errorMessage: nil, updatedAt: Date())
    }
    func resource(bytes: Data) -> ResourceManifest {
        ResourceManifest(role: "photo", filename: "IMG_0001.jpg", stagingPath: "unused", byteCount: Int64(bytes.count), sha256: digest(bytes), finalPath: nil, temporaryPath: nil)
    }
    func coordinator(_ remote: MemoryRemote, store: SyncStore? = nil) -> SyncCoordinator {
        SyncCoordinator(store: store ?? self.store, stagingRoot: stagingRoot, makeRemote: { remote }) { identifier, runID, id, budget, runtime in
            try runtime.check()
            let directory = budget.root.appendingPathComponent(runID.uuidString).appendingPathComponent(id.uuidString)
            try budget.remove(directory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let roles = identifier == "live" ? ["photo", "pairedVideo"] : ["photo"]
            return try roles.map { role in
                let bytes = Data("original-\(identifier)\(role == "photo" ? "" : "-video")".utf8)
                let file = directory.appendingPathComponent(role)
                try budget.reserve(Int64(bytes.count), runtime: runtime)
                try bytes.write(to: file)
                return ResourceManifest(role: role, filename: "IMG_0001.\(role == "photo" ? "jpg" : "mov")", stagingPath: file.path, byteCount: Int64(bytes.count), sha256: digest(bytes), finalPath: nil, temporaryPath: nil)
            }
        }
    }
}

private func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }

private actor MemoryRemote: RemoteFileService {
    enum Mode { case normal, interruptUpload, corruptPartial, loseRenameAcknowledgement, diskFull, workerConnectionFailure, blockUpload }
    var files = [String: Data]()
    var mediaOffsets = [Int64]()
    var hashCalls = 0
    private var mode: Mode
    private var connections = 0
    private var blocked: CheckedContinuation<Void, Never>?
    private var observer: CheckedContinuation<Void, Never>?
    init(mode: Mode = .normal) { self.mode = mode }
    func put(_ data: Data, at path: String) { files[path] = data }
    func connect(profile: ServerProfile, password: String?) throws {
        connections += 1
        if mode == .workerConnectionFailure, connections == 2 { throw CocoaError(.fileReadNoPermission) }
    }
    func disconnect() {}
    func createDirectory(path: String) {}
    func listShares() -> [String] { ["Photos"] }
    func listDirectory(path: String) -> [RemoteItem] { [] }
    func stat(path: String) -> RemoteItem? { files[path].map { RemoteItem(name: path, path: path, byteCount: Int64($0.count), isDirectory: false) } }
    func read(path: String) throws -> Data { guard let data = files[path] else { throw CocoaError(.fileNoSuchFile) }; return data }
    func hash(path: String, prefixBytes: Int64?, check: @escaping @Sendable () throws -> Void) throws -> String {
        try check()
        hashCalls += 1
        let bytes = try read(path: path)
        return digest(prefixBytes.map { Data(bytes.prefix(Int($0))) } ?? bytes)
    }
    func upload(file: URL, to path: String, offset: Int64, progress: @escaping @Sendable (Int64) throws -> Void) async throws {
        let bytes = try Data(contentsOf: file)
        if !path.hasPrefix(".picsync/") {
            mediaOffsets.append(offset)
            if mode == .diskFull { throw CocoaError(.fileWriteOutOfSpace) }
            if mode == .interruptUpload || mode == .corruptPartial {
                files[path] = mode == .corruptPartial ? Data("xxx".utf8) : Data(bytes.prefix(3))
                mode = .normal
                throw URLError(.networkConnectionLost)
            }
            if mode == .blockUpload {
                mode = .normal
                await withCheckedContinuation { continuation in
                    blocked = continuation
                    observer?.resume(); observer = nil
                }
            }
        }
        try progress(offset)
        if offset == 0 {
            guard files[path] == nil else { throw CocoaError(.fileWriteFileExists) }
        } else {
            guard files[path] == Data(bytes.prefix(Int(offset))) else { throw CocoaError(.fileReadCorruptFile) }
        }
        files[path] = bytes
        try progress(Int64(bytes.count))
    }
    func rename(from: String, to: String) throws {
        guard files[to] == nil else { throw CocoaError(.fileWriteFileExists) }
        files[to] = try read(path: from)
        files[from] = nil
        if mode == .loseRenameAcknowledgement, !to.hasPrefix(".picsync/") {
            mode = .normal
            throw NSError(domain: "InjectedCrash", code: 1)
        }
    }
    func delete(path: String) { files[path] = nil }
    func waitForBlockedUpload() async {
        if blocked != nil { return }
        await withCheckedContinuation { observer = $0 }
    }
    func releaseUpload() { blocked?.resume(); blocked = nil }
}
