import Foundation
import Observation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import SMBClient

actor SyncCoordinator {
    private let store: SyncStore
    typealias Stage = @Sendable (String, UUID, UUID, StagingBudget, TransferRuntime) async throws -> [ResourceManifest]
    private let stage: Stage
    private let makeRemote: @Sendable () -> any RemoteFileService
    private let fingerprintGate = FingerprintGate()
    private let recordDirectoryGate = FingerprintGate()
    private let exportGate = FingerprintGate()
    private var pausedRuns = Set<UUID>()
    private var activeRuns = Set<UUID>()
    private var workerCounts = [UUID: Int]()
    private var runtimes = [UUID: TransferRuntime]()
    private var budgets = [UUID: StagingBudget]()
    private let stagingRoot: URL

    init(store: SyncStore, stagingRoot: URL? = nil, makeRemote: @escaping @Sendable () -> any RemoteFileService = { SMBRemoteFileService() }, stage: @escaping Stage = { identifier, runID, transferID, budget, runtime in
        let asset = try PhotoLibraryService().asset(for: identifier)
        return try await PhotoResourceExporter().stage(asset: asset, runID: runID, transferID: transferID, budget: budget, runtime: runtime)
    }) {
        self.store = store
        self.makeRemote = makeRemote
        self.stage = stage
        self.stagingRoot = stagingRoot ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Transfers", isDirectory: true)
    }

    func createRun(itemIdentifiers: [String], profile: ServerProfile, destinationPath: String, parallelism: Int, sourceLabel: String = "Selected Photos") async throws -> SyncRun {
        let now = Date()
        let run = SyncRun(id: UUID(), sourceLabel: sourceLabel, assetIdentifiers: itemIdentifiers, profileID: profile.id, share: profile.share, destinationPath: RemotePath.normalize(destinationPath), parallelism: min(max(parallelism, 1), 20), activeWorkerCount: 0, state: .preparing, createdAt: now, updatedAt: now, completedBytes: 0, totalBytes: 0, completedCount: 0, skippedCount: 0, failedCount: 0)
        let transfers = itemIdentifiers.map { AssetTransfer(id: UUID(), runID: run.id, localIdentifier: $0, state: .queued, manifest: [], fingerprint: nil, attempts: 0, errorMessage: nil, updatedAt: now) }
        try await store.save(run: run, transfers: transfers)
        AppLog.write("[Sync] created run=\(run.id.uuidString) source=\(sourceLabel) items=\(itemIdentifiers.count) destination=\(run.destinationPath)")
        return run
    }

    func pause(_ runID: UUID) async throws {
        pausedRuns.insert(runID)
        runtimes[runID]?.pause()
        guard let existingRun = try await store.run(runID) else { return }
        guard ![.completed, .completedWithErrors, .cancelled].contains(existingRun.state) else { return }
        let hasPending = try await store.hasPending(runID)
        guard hasPending else { return }
        guard var run = try await store.run(runID) else { return }
        run.state = activeRuns.contains(runID) ? .pausing : .paused
        #if DEBUG
        AppLog.write("[Sync] pause run=\(runID.uuidString) state=\(run.state.rawValue) activeWorkers=\(workerCounts[runID] ?? 0)")
        #endif
        run.updatedAt = Date()
        try await store.save(run: run)
    }

    func delete(_ runID: UUID) async throws {
        guard !activeRuns.contains(runID) else { throw PicSyncError.runActive }
        pausedRuns.remove(runID)
        workerCounts[runID] = nil
        let root = stagingRoot.appendingPathComponent(runID.uuidString, isDirectory: true)
        if let budget = budgets.values.first { try budget.remove(root) }
        else if FileManager.default.fileExists(atPath: root.path) { try FileManager.default.removeItem(at: root) }
        try await store.deleteRun(runID)
    }

    func run(_ runID: UUID, profile: ServerProfile, password: String?, parallelism: Int, stagingLimit: Int64 = 8 * 1_024 * 1_024 * 1_024) async throws {
        guard activeRuns.isEmpty else { return }
        activeRuns.insert(runID)
        pausedRuns.remove(runID)
        defer {
            activeRuns.remove(runID)
            workerCounts[runID] = nil
            runtimes[runID] = nil
            budgets[runID] = nil
        }
        guard var run = try await store.run(runID) else { return }
        runtimes[runID] = TransferRuntime()
        let budget = try StagingBudget(root: stagingRoot, limit: stagingLimit)
        budgets[runID] = budget
        try await cleanupAbandonedStaging(budget)
        try await store.recoverClaims(for: runID)
        let requestedParallelism = min(max(parallelism, 1), 20)
        #if DEBUG
        AppLog.write("[Sync] resume run=\(runID.uuidString) state=\(run.state.rawValue)")
        #endif
        // An explicit Resume is also the user's request to retry failed records in bounded transactions.
        let requeuedCount = try await store.requeueFailedTransfers(for: runID)
        #if DEBUG
        AppLog.write("[Sync] requeued run=\(runID.uuidString) transfers=\(requeuedCount)")
        #endif
        guard !pausedRuns.contains(runID) else { try await finish(runID); return }
        run = try await store.run(runID) ?? run
        run.parallelism = requestedParallelism
        run.pauseReason = nil
        run.state = .running; run.updatedAt = Date(); try await store.save(run: run)
        let setupRemote = makeRemote()
        do {
            #if DEBUG
            AppLog.write("[Sync] connecting run=\(runID.uuidString) share=\(profile.share) destination=\(run.destinationPath)")
            #endif
            try await connect(setupRemote, runID: runID, profile: profile, password: password)
            try await setupRemote.createDirectory(path: run.destinationPath)
            try await setupRemote.createDirectory(path: ".picsync/objects")
            await setupRemote.disconnect()
        } catch {
            #if DEBUG
            AppLog.write("[Sync] setup failed run=\(runID.uuidString) error=\(String(reflecting: error))")
            #endif
            await setupRemote.disconnect()
            try await stopRun(runID, reason: error.localizedDescription)
            try await finish(runID)
            throw error
        }
        guard !pausedRuns.contains(runID) else { try await finish(runID); return }
        let workerCount = min(run.parallelism, run.itemCount)
        #if DEBUG
        AppLog.write("[Sync] scheduling run=\(runID.uuidString) requestedWorkers=\(requestedParallelism) workers=\(workerCount)")
        #endif
        workerCounts[runID] = workerCount
        try await updateWorkerCount(runID)
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<workerCount {
                group.addTask {
                    await self.work(runID: runID, profile: profile, password: password)
                    await self.workerFinished(runID)
                }
            }
        }
        try await finish(runID)
    }

    private func work(runID: UUID, profile: ServerProfile, password: String?) async {
        let remote = makeRemote()
        do {
            try await connect(remote, runID: runID, profile: profile, password: password)
            while !isPaused(runID), let transfer = try await store.claimNext(runID) {
                // The claim is durable. Even a pause between claim and processing is recovered.
                var attempt = 0
                while true {
                    do {
                        try await process(transfer, runID: runID, remote: remote)
                        break
                    } catch {
                        if isPaused(runID) { break }
                        if TransferFailurePolicy.isDestinationWide(error) {
                            try await stopRun(runID, reason: error.localizedDescription)
                            break
                        }
                        if TransferFailurePolicy.isTransient(error), attempt < 3 {
                            attempt += 1
                            runtimes[runID]?.update(transfer.id, filename: transfer.manifest.first?.filename ?? "Photo item", phase: "Retry \(attempt)/3 in \(1 << attempt)s")
                            try await Task.sleep(for: .seconds(1 << attempt))
                            await remote.disconnect()
                            try await connect(remote, runID: runID, profile: profile, password: password)
                            continue
                        }
                        // Unknown SMB errors can affect every item. Stop rather than fill staging.
                        if TransferFailurePolicy.isTransient(error) || error is ErrorResponse {
                            try await stopRun(runID, reason: error.localizedDescription)
                        }
                        break
                    }
                }
                runtimes[runID]?.remove(transfer.id)
            }
        } catch {
            if !isPaused(runID) { try? await stopRun(runID, reason: error.localizedDescription) }
        }
        await remote.disconnect()
    }

    private func connect(_ remote: any RemoteFileService, runID: UUID, profile: ServerProfile, password: String?) async throws {
        for attempt in 0...3 {
            try runtimes[runID]?.check()
            do { try await remote.connect(profile: profile, password: password); return }
            catch {
                await remote.disconnect()
                guard attempt < 3, TransferFailurePolicy.isTransient(error) else { throw error }
                try await Task.sleep(for: .seconds(1 << attempt))
            }
        }
    }

    private func process(_ original: AssetTransfer, runID: UUID, remote: any RemoteFileService) async throws {
        guard let runtime = runtimes[runID], let budget = budgets[runID] else { throw TransferError.paused }
        var transfer = try await store.transfer(original.id) ?? original
        var lockedFingerprint: String?
        defer { budget.endDraining(transfer.id) }
        do {
            try runtime.check()
            runtime.update(transfer.id, filename: transfer.manifest.first?.filename ?? "Photo item", phase: "Checking staged original")
            if try await !SyncStore.hasValidStaging(transfer.manifest, runtime: runtime) {
                transfer.state = .exporting; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                let previous = transfer.manifest
                let staged = try await stageOriginal(transfer, runID: runID, budget: budget, runtime: runtime)
                transfer.manifest = staged.map { resource in
                    var resource = resource
                    if let old = previous.first(where: { $0.role == resource.role && $0.sha256 == resource.sha256 && $0.filename == resource.filename }) {
                        resource.finalPath = old.finalPath
                        resource.temporaryPath = old.temporaryPath
                    }
                    return resource
                }
                transfer.fingerprint = ContentHasher.assetFingerprint(transfer.manifest)
                transfer.state = .staged; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            }
            budget.beginDraining(transfer.id)
            guard let fingerprint = transfer.fingerprint else { throw PicSyncError.sourceUnavailable }
            await fingerprintGate.acquire(fingerprint)
            lockedFingerprint = fingerprint
            try runtime.check()
            let recordPath = ".picsync/objects/\(fingerprint.prefix(2))/\(fingerprint).json"
            if try await isValidContentRecord(path: recordPath, fingerprint: fingerprint, remote: remote) {
                transfer.state = .skippedDuplicate
                transfer.updatedAt = Date()
                try await store.save(transfer: transfer)
                cleanupStaging(for: transfer, budget: budget)
                await fingerprintGate.release(fingerprint)
                return
            }
            transfer.state = .uploading; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            for index in transfer.manifest.indices {
                try runtime.check()
                var resource = transfer.manifest[index]
                if let final = resource.finalPath, let existing = try await remote.stat(path: final) {
                    runtime.update(transfer.id, filename: resource.filename, phase: "Verifying recovered file")
                    if !existing.isDirectory, existing.byteCount == resource.byteCount,
                       try await remote.hash(path: final, prefixBytes: nil, check: { try runtime.check() }) == resource.sha256 {
                        continue
                    }
                    // Preserve unrelated or corrupt existing content and pick a new name.
                    resource.finalPath = nil
                    resource.temporaryPath = nil
                }
                let final: String
                if let existing = resource.finalPath {
                    final = existing
                } else {
                    final = try await availableName(resource.filename, hash: resource.sha256, directory: runDestination(runID), runID: runID, remote: remote)
                }
                let temporary = resource.temporaryPath ?? join(remoteDirectory(final), ".picsync-\(transfer.id.uuidString)-\(index).partial")
                resource.finalPath = final; resource.temporaryPath = temporary; transfer.manifest[index] = resource
                try await store.save(transfer: transfer)
                let file = URL(fileURLWithPath: resource.stagingPath)
                runtime.update(transfer.id, filename: resource.filename, phase: "Checking partial upload")
                let offset = try await resumableOffset(resource: resource, remote: remote, runtime: runtime)
                let id = transfer.id, name = resource.filename, size = resource.byteCount
                runtime.update(id, filename: name, phase: "Uploading", bytes: offset, total: size)
                if offset < size || size == 0 {
                    try await remote.upload(file: file, to: temporary, offset: offset) { bytes in
                        try runtime.check()
                        runtime.update(id, filename: name, phase: "Uploading", bytes: bytes, total: size)
                    }
                }
                guard (try await remote.stat(path: temporary))?.byteCount == resource.byteCount else { throw CocoaError(.fileReadCorruptFile) }
            }
            transfer.state = .committing; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            for resource in transfer.manifest {
                try runtime.check()
                guard let final = resource.finalPath, let temporary = resource.temporaryPath else { throw PicSyncError.sourceUnavailable }
                if try await remote.stat(path: final) == nil {
                    try await remote.rename(from: temporary, to: final)
                } else {
                    // Never accept a same-sized file as proof that our rename succeeded.
                    guard try await remote.hash(path: final, prefixBytes: nil, check: { try runtime.check() }) == resource.sha256 else { throw TransferError.contentMismatch(final) }
                }
            }
            transfer.state = .indexing; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            try await commitContentRecord(for: transfer, runID: runID, remote: remote)
            transfer.state = .completed; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            cleanupStaging(for: transfer, budget: budget)
            await fingerprintGate.release(fingerprint)
            return
        } catch {
            if let lockedFingerprint { await fingerprintGate.release(lockedFingerprint) }
            #if DEBUG
            let paths = transfer.manifest.compactMap(\.finalPath).joined(separator: ",")
            AppLog.write("[Sync] asset failed transfer=\(transfer.id.uuidString) state=\(transfer.state.rawValue) paths=\(paths) error=\(String(reflecting: error))")
            #endif
            transfer.state = isPaused(runID) ? (transfer.manifest.isEmpty ? .queued : .staged) : .failed
            transfer.attempts += 1; transfer.errorMessage = error.localizedDescription; transfer.updatedAt = Date()
            try await store.save(transfer: transfer)
            throw error
        }
    }

    private func stageOriginal(_ transfer: AssetTransfer, runID: UUID, budget: StagingBudget, runtime: TransferRuntime) async throws -> [ResourceManifest] {
        // Serialize exports, not uploads, so partially exported videos cannot exhaust the
        // budget while every worker waits for another exporter to release space.
        await exportGate.acquire("export")
        do {
            try runtime.check()
            let resources = try await stage(transfer.localIdentifier, runID, transfer.id, budget, runtime)
            guard !resources.isEmpty else { throw PicSyncError.sourceUnavailable }
            budget.beginDraining(transfer.id)
            await exportGate.release("export")
            return resources
        } catch {
            await exportGate.release("export")
            throw error
        }
    }

    private func resumableOffset(resource: ResourceManifest, remote: any RemoteFileService, runtime: TransferRuntime) async throws -> Int64 {
        guard let path = resource.temporaryPath, let item = try await remote.stat(path: path) else { return 0 }
        // Owned partial files are reused only after comparing every existing byte.
        if !item.isDirectory, item.byteCount > 0, item.byteCount <= resource.byteCount {
            let localHash = try await ContentHasher.hashAsync(file: URL(fileURLWithPath: resource.stagingPath), prefixBytes: item.byteCount, check: { try runtime.check() })
            if try await remote.hash(path: path, prefixBytes: item.byteCount, check: { try runtime.check() }) == localHash { return item.byteCount }
        }
        try await remote.delete(path: path)
        return 0
    }

    private func isPaused(_ runID: UUID) -> Bool { pausedRuns.contains(runID) }
    private func workerFinished(_ runID: UUID) async {
        workerCounts[runID] = max((workerCounts[runID] ?? 1) - 1, 0)
        #if DEBUG
        AppLog.write("[Sync] worker finished run=\(runID.uuidString) activeWorkers=\(workerCounts[runID] ?? 0)")
        #endif
        try? await updateWorkerCount(runID)
    }
    private func updateWorkerCount(_ runID: UUID) async throws {
        try await store.setActiveWorkerCount(workerCounts[runID] ?? 0, for: runID)
    }
    private func runDestination(_ runID: UUID) async throws -> String { try await store.run(runID).map { RemotePath.normalize("\($0.destinationPath)/") } ?? "" }
    private func availableName(_ name: String, hash: String, directory: String, runID: UUID, remote: any RemoteFileService) async throws -> String {
        let candidates = [join(directory, name)] + (0...32).map { join(directory, SafeFilename.collisionName(for: name, hash: hash, attempt: $0)) }
        for candidate in candidates {
            if try await remote.stat(path: candidate) == nil,
               try await store.reservePath(candidate, runID: runID) {
                return candidate
            }
        }
        throw CocoaError(.fileWriteFileExists)
    }
    private func commitContentRecord(for transfer: AssetTransfer, runID: UUID, remote: any RemoteFileService) async throws {
        guard let fingerprint = transfer.fingerprint else { throw PicSyncError.sourceUnavailable }
        let prefix = String(fingerprint.prefix(2))
        await recordDirectoryGate.acquire(prefix)
        do {
            try await remote.createDirectory(path: ".picsync/objects/\(prefix)")
            await recordDirectoryGate.release(prefix)
        } catch {
            await recordDirectoryGate.release(prefix)
            throw error
        }
        let recordPath = ".picsync/objects/\(prefix)/\(fingerprint).json"
        if try await isValidContentRecord(path: recordPath, fingerprint: fingerprint, remote: remote) { return }
        if try await remote.stat(path: recordPath) != nil { try await remote.delete(path: recordPath) }
        let record = RemoteContentRecord(schemaVersion: 1, fingerprint: fingerprint, resources: transfer.manifest, runID: runID, transferID: transfer.id, committedAt: Date())
        let localURL = URL(fileURLWithPath: transfer.manifest[0].stagingPath).deletingLastPathComponent().appendingPathComponent("\(fingerprint).json")
        try JSONEncoder().encode(record).write(to: localURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: localURL) }
        let temporaryPath = "\(recordPath).picsync-\(transfer.id.uuidString).partial"
        if try await remote.stat(path: temporaryPath) != nil { try await remote.delete(path: temporaryPath) }
        try await remote.upload(file: localURL, to: temporaryPath, offset: 0) { _ in }
        try await remote.rename(from: temporaryPath, to: recordPath)
    }
    private func isValidContentRecord(path: String, fingerprint: String, remote: any RemoteFileService) async throws -> Bool {
        guard let item = try await remote.stat(path: path), item.byteCount > 0, item.byteCount <= 1_048_576 else { return false }
        let data = try await remote.read(path: path)
        guard let record = try? JSONDecoder().decode(RemoteContentRecord.self, from: data),
              record.schemaVersion == 1,
              record.fingerprint == fingerprint,
              !record.resources.isEmpty,
              ContentHasher.assetFingerprint(record.resources) == fingerprint else { return false }
        for resource in record.resources {
            guard let finalPath = resource.finalPath,
                  let item = try await remote.stat(path: finalPath),
                  !item.isDirectory, item.byteCount == resource.byteCount else { return false }
        }
        return true
    }
    private func join(_ directory: String, _ name: String) -> String { [directory, name].filter { !$0.isEmpty }.joined(separator: "/") }
    private func remoteDirectory(_ path: String) -> String { path.split(separator: "/").dropLast().joined(separator: "/") }
    private func stopRun(_ runID: UUID, reason: String) async throws {
        // Only the run is paused. Other workers checkpoint their own transfers.
        pausedRuns.insert(runID)
        runtimes[runID]?.pause()
        guard var run = try await store.run(runID) else { return }
        run.pauseReason = run.pauseReason ?? reason
        run.state = .pausing
        try await store.save(run: run)
    }
    func progress(_ runID: UUID) -> TransferRuntime.Snapshot? {
        runtimes[runID]?.snapshot()
    }
    private func finish(_ runID: UUID) async throws {
        guard var run = try await store.run(runID) else { return }
        let hasPending = try await store.hasPending(runID)
        if hasPending || run.pauseReason != nil {
            run.state = .paused
        } else {
            pausedRuns.remove(runID)
            run.state = run.failedCount == 0 ? .completed : .completedWithErrors
        }
        #if DEBUG
        AppLog.write("[Sync] finish run=\(runID.uuidString) state=\(run.state.rawValue) pending=\(hasPending) activeWorkers=\(workerCounts[runID] ?? 0)")
        #endif
        run.updatedAt = Date(); try await store.save(run: run)
    }
    private func cleanupStaging(for transfer: AssetTransfer, budget: StagingBudget) {
        guard let path = transfer.manifest.first?.stagingPath else { return }
        try? budget.remove(URL(fileURLWithPath: path).deletingLastPathComponent())
    }
    private func cleanupAbandonedStaging(_ budget: StagingBudget) async throws {
        // Enumerate only directories still on disk, not all archived transfer rows.
        for runDirectory in try FileManager.default.contentsOfDirectory(at: stagingRoot, includingPropertiesForKeys: nil) {
            guard let runID = UUID(uuidString: runDirectory.lastPathComponent) else { continue }
            guard try await store.run(runID) != nil else { try budget.remove(runDirectory); continue }
            for directory in try FileManager.default.contentsOfDirectory(at: runDirectory, includingPropertiesForKeys: nil) {
                guard let id = UUID(uuidString: directory.lastPathComponent) else { continue }
                let transfer = try await store.transfer(id)
                if transfer == nil || transfer?.state == .completed || transfer?.state == .skippedDuplicate || transfer?.manifest.isEmpty == true {
                    try budget.remove(directory)
                }
            }
        }
    }
}

actor FingerprintGate {
    private var active = Set<String>()
    private var waiters = [String: [CheckedContinuation<Void, Never>]]()

    func acquire(_ fingerprint: String) async {
        guard active.contains(fingerprint) else {
            active.insert(fingerprint)
            return
        }
        await withCheckedContinuation { continuation in
            waiters[fingerprint, default: []].append(continuation)
        }
    }

    func release(_ fingerprint: String) {
        if var queued = waiters[fingerprint], !queued.isEmpty {
            let next = queued.removeFirst()
            waiters[fingerprint] = queued.isEmpty ? nil : queued
            next.resume()
        } else {
            active.remove(fingerprint)
        }
    }
}

enum ConnectionTestError: LocalizedError {
    case timedOut

    var errorDescription: String? {
        "The server did not respond within 10 seconds. Check the address and make sure SMB is available on this network."
    }
}

func withConnectionTestTimeout<T: Sendable>(
    after duration: Duration = .seconds(10),
    _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(for: duration)
            throw ConnectionTestError.timedOut
        }
        defer { group.cancelAll() }
        guard let result = try await group.next() else { throw CancellationError() }
        return result
    }
}

@MainActor @Observable final class AppModel {
    private let store: SyncStore
    private let coordinator: SyncCoordinator
    private var browserService: SMBRemoteFileService?
    private var browserPassword: String?
    private var hasLoaded = false
    var profile: ServerProfile?
    var profiles: [ServerProfile] = []
    var runs: [SyncRun] = []
    var errorMessage: String?
    var connectionVerified = false
    var connectionStatus: String?
    var isTestingConnection = false
    var hasSavedPassword = false
    private(set) var activeRunIDs = Set<UUID>() {
        didSet {
            #if canImport(UIKit)
            UIApplication.shared.isIdleTimerDisabled = !activeRunIDs.isEmpty
            #endif
        }
    }
    private(set) var transferItemsByRun = [UUID: [AssetTransfer]]()
    var presentsPhotoSelection = false
    var parallelism: Int {
        didSet { UserDefaults.standard.set(parallelism, forKey: "parallelism") }
    }
    var stagingLimitGB: Int {
        didSet { UserDefaults.standard.set(stagingLimitGB, forKey: "stagingLimitGB") }
    }
    private(set) var progressByRun = [UUID: TransferRuntime.Snapshot]()
    var isShowingError: Bool { errorMessage != nil }

    init() {
        let store = SyncStore()
        self.store = store
        coordinator = SyncCoordinator(store: store)
        let savedParallelism = UserDefaults.standard.integer(forKey: "parallelism")
        parallelism = (1...20).contains(savedParallelism) ? savedParallelism : 2
        let savedLimit = UserDefaults.standard.integer(forKey: "stagingLimitGB")
        stagingLimitGB = (2...128).contains(savedLimit) ? savedLimit : 8
    }

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        do {
            try await store.load()
            profiles = try await store.profiles()
            let activeProfileID = try await store.activeProfileID()
            profile = profiles.first { $0.id == activeProfileID } ?? profiles.first
            if let profile, activeProfileID != profile.id { try await store.selectProfile(profile.id) }
            runs = try await store.runs()
            if let profile { hasSavedPassword = (try CredentialStore.password(profileID: profile.id)) != nil }
        } catch {
            hasLoaded = false
            show(error)
        }
    }
    func refresh() async {
        do {
            runs = try await store.runs()
            for run in runs { progressByRun[run.id] = await coordinator.progress(run.id) }
        } catch { show(error) }
    }
    func selectProfile(_ selected: ServerProfile) async {
        do {
            try await store.selectProfile(selected.id)
            profile = selected
            hasSavedPassword = (try CredentialStore.password(profileID: selected.id)) != nil
        } catch { show(error) }
    }
    func savedPasswordExists(for editedProfile: ServerProfile?) -> Bool {
        guard let editedProfile else { return false }
        return (try? CredentialStore.password(profileID: editedProfile.id)) != nil
    }
    func saveProfile(draft: ServerProfileDraft, password: String, editing previousProfile: ServerProfile?) async throws {
        var saved = try draft.profile()
        let sameServer = previousProfile.map {
            $0.host == saved.host && $0.port == saved.port && $0.username == saved.username && $0.domain == saved.domain
        } ?? false
        let sameDestinationConnection = previousProfile.map {
            sameServer && $0.share == saved.share && $0.requiresSigning == saved.requiresSigning
        } ?? false
        if let previousProfile, sameDestinationConnection {
            saved.id = previousProfile.id
            saved.createdAt = previousProfile.createdAt
        }
        let credential = password.isEmpty && sameServer ? try previousProfile.flatMap { try CredentialStore.password(profileID: $0.id) } : password
        guard let credential, !credential.isEmpty else { throw PicSyncError.passwordRequired }
        try CredentialStore.save(credential, profileID: saved.id)
        hasSavedPassword = true
        try await store.save(profile: saved)
        try await store.selectProfile(saved.id)
        profile = saved
        profiles = try await store.profiles()
    }
    func resetConnectionVerification() { connectionVerified = false; connectionStatus = nil }
    func resetProfileEditor() async {
        await browserService?.disconnect()
        browserService = nil
        browserPassword = nil
        resetConnectionVerification()
    }
    func testConnection(draft: ServerProfileDraft, password: String, editing previousProfile: ServerProfile?) async throws -> [String] {
        isTestingConnection = true
        connectionVerified = false
        connectionStatus = nil
        defer { isTestingConnection = false }
        var candidate = try draft.profile(reusing: previousProfile?.id)
        candidate.share = ""
        let connectionProfile = candidate
        let sameServer = previousProfile.map {
            $0.host == candidate.host && $0.port == candidate.port && $0.username == candidate.username && $0.domain == candidate.domain
        } ?? false
        let credential = password.isEmpty && sameServer ? try previousProfile.flatMap { try CredentialStore.password(profileID: $0.id) } : password
        guard let credential, !credential.isEmpty else { throw PicSyncError.passwordRequired }
        let remote = SMBRemoteFileService()
        do {
            let shares = try await withConnectionTestTimeout {
                try await remote.connect(profile: connectionProfile, password: credential)
                return try await remote.listShares()
            }
            await remote.disconnect()
            browserPassword = credential
            connectionVerified = true
            connectionStatus = "Connected as \(candidate.username). Choose a share and upload folder."
            return shares
        } catch {
            await remote.disconnect()
            connectionStatus = error.localizedDescription
            throw error
        }
    }
    func openShare(_ share: String, draft: ServerProfileDraft, password: String, editing previousProfile: ServerProfile?) async throws {
        await browserService?.disconnect()
        var candidate = try draft.profile(reusing: previousProfile?.id)
        candidate.share = share
        let sameServer = previousProfile.map {
            $0.host == candidate.host && $0.port == candidate.port && $0.username == candidate.username && $0.domain == candidate.domain
        } ?? false
        let storedCredential = sameServer ? try previousProfile.flatMap { try CredentialStore.password(profileID: $0.id) } : nil
        let credential = password.isEmpty ? (browserPassword ?? storedCredential) : password
        guard let credential, !credential.isEmpty else { throw PicSyncError.passwordRequired }
        let remote = SMBRemoteFileService()
        do {
            try await remote.connect(profile: candidate, password: credential)
            browserPassword = credential
            connectionVerified = true
            connectionStatus = "Connected as \(candidate.username). Choose an upload folder."
            browserService = remote
        }
        catch {
            #if DEBUG
            AppLog.write("[SMB] failed share=\(share) error=\(String(reflecting: error))")
            #endif
            await remote.disconnect()
            throw SMBShareError(share: share, underlying: error)
        }
    }
    func openShare(profile: ServerProfile) async throws {
        let credential = try CredentialStore.password(profileID: profile.id)
        guard let credential, !credential.isEmpty else { throw PicSyncError.passwordRequired }
        await browserService?.disconnect()
        let remote = SMBRemoteFileService()
        do {
            try await remote.connect(profile: profile, password: credential)
            browserPassword = credential
            browserService = remote
        } catch {
            await remote.disconnect()
            throw SMBShareError(share: profile.share, underlying: error)
        }
    }
    func remoteDirectory(path: String) async throws -> [RemoteItem] {
        guard let browserService else { throw URLError(.notConnectedToInternet) }
        do { return try await browserService.listDirectory(path: path) }
        catch { throw SMBBrowseError(path: path, underlying: error) }
    }
    func createRemoteDirectory(parentPath: String, name: String) async throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\") else {
            throw PicSyncError.invalidFolderName
        }
        guard let browserService else { throw URLError(.notConnectedToInternet) }
        let path = [parentPath, name].filter { !$0.isEmpty }.joined(separator: "/")
        try await browserService.createDirectory(path: path)
    }
    func createRun(identifiers: [String], destinationPath: String, parallelism: Int) async throws -> SyncRun { guard let profile else { throw PicSyncError.invalidServerAddress }; guard !identifiers.isEmpty else { throw PicSyncError.sourceUnavailable }; try PhotoLibraryService().validateOriginalAvailability(for: identifiers); let run = try await coordinator.createRun(itemIdentifiers: identifiers, profile: profile, destinationPath: destinationPath, parallelism: parallelism); runs = try await store.runs(); return run }
    func createAlbumRun(_ album: PhotoAlbum, destinationPath: String, parallelism: Int) async throws -> SyncRun { guard let profile else { throw PicSyncError.invalidServerAddress }; guard !album.isCloudShared else { throw PicSyncError.sharedAlbumOriginalUnavailable }; let identifiers = try PhotoLibraryService().assetIdentifiers(forAlbumID: album.id); guard !identifiers.isEmpty else { throw PicSyncError.sourceUnavailable }; try PhotoLibraryService().validateOriginalAvailability(for: identifiers); let run = try await coordinator.createRun(itemIdentifiers: identifiers, profile: profile, destinationPath: destinationPath, parallelism: parallelism, sourceLabel: album.title); runs = try await store.runs(); return run }
    func pause(runID: UUID) async {
        if let index = runs.firstIndex(where: { $0.id == runID }) { runs[index].state = .pausing }
        do { try await coordinator.pause(runID); runs = try await store.runs() } catch { show(error) }
    }
    func delete(runID: UUID) async -> Bool {
        guard !activeRunIDs.contains(runID) else { show(PicSyncError.runActive); return false }
        do {
            try await coordinator.delete(runID)
            transferItemsByRun[runID] = nil
            runs = try await store.runs()
            return true
        } catch {
            show(error)
            return false
        }
    }
    func loadTransfers(runID: UUID) async {
        do { transferItemsByRun[runID] = try await store.transfers(for: runID, state: .failed, limit: 5) }
        catch { show(error) }
    }
    func transfers(for runID: UUID) -> [AssetTransfer] { transferItemsByRun[runID] ?? [] }
    func resume(runID: UUID) async {
        guard activeRunIDs.isEmpty else { show(PicSyncError.syncAlreadyRunning); return }
        guard let run = runs.first(where: { $0.id == runID }),
              let profile = profiles.first(where: { $0.id == run.profileID }) else { show(PicSyncError.invalidServerAddress); return }
        let password: String?
        do { password = try CredentialStore.password(profileID: profile.id) }
        catch { show(error); return }
        guard let password, !password.isEmpty else { show(PicSyncError.passwordRequired); return }
        activeRunIDs.insert(runID)
        if let index = runs.firstIndex(where: { $0.id == runID }) { runs[index].state = .running }
        defer { activeRunIDs.remove(runID) }
        #if DEBUG
        AppLog.write("[Sync] resume button run=\(runID.uuidString) profile=\(profile.id.uuidString)")
        #endif
        do {
            try await coordinator.run(runID, profile: profile, password: password, parallelism: parallelism, stagingLimit: Int64(stagingLimitGB) * 1_024 * 1_024 * 1_024)
            await refresh()
            await loadTransfers(runID: runID)
        } catch {
            #if DEBUG
            AppLog.write("[Sync] resume failed run=\(runID.uuidString) error=\(String(reflecting: error))")
            #endif
            await refresh()
            await loadTransfers(runID: runID)
            show(error)
        }
    }
    func show(_ error: Error) {
        AppLog.write("[Error] \(String(reflecting: error))")
        errorMessage = error.localizedDescription
    }
}
