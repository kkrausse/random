import Foundation
import Observation
import SwiftUI
import UIKit

actor SyncCoordinator {
    private let store: SyncStore
    private let photoLibrary = PhotoLibraryService()
    private let exporter = PhotoResourceExporter()
    private let makeRemote: @Sendable () -> any RemoteFileService
    private let fingerprintGate = FingerprintGate()
    private let recordDirectoryGate = FingerprintGate()
    private var pausedRuns = Set<UUID>()
    private var activeRuns = Set<UUID>()
    private var reservedPaths = [UUID: Set<String>]()
    private var workerCounts = [UUID: Int]()

    init(store: SyncStore, makeRemote: @escaping @Sendable () -> any RemoteFileService = { SMBRemoteFileService() }) {
        self.store = store
        self.makeRemote = makeRemote
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
        guard let existingRun = await store.run(runID) else { return }
        guard ![.completed, .completedWithErrors, .cancelled].contains(existingRun.state) else { return }
        let hasPending = await store.transfers(for: runID).contains { !$0.state.isTerminal }
        guard hasPending else { return }
        guard var run = await store.run(runID) else { return }
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
        reservedPaths[runID] = nil
        workerCounts[runID] = nil
        try await store.deleteRun(runID)
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Transfers", isDirectory: true)
            .appendingPathComponent(runID.uuidString, isDirectory: true)
        try? FileManager.default.removeItem(at: root)
    }

    func run(_ runID: UUID, profile: ServerProfile, password: String?, parallelism: Int) async throws {
        guard activeRuns.isEmpty else { return }
        activeRuns.insert(runID)
        pausedRuns.remove(runID)
        defer {
            activeRuns.remove(runID)
            reservedPaths[runID] = nil
            workerCounts[runID] = nil
        }
        guard var run = await store.run(runID) else { return }
        let requestedParallelism = min(max(parallelism, 1), 20)
        #if DEBUG
        AppLog.write("[Sync] resume run=\(runID.uuidString) state=\(run.state.rawValue)")
        #endif
        // An explicit Resume is also the user's request to retry failed records in one journal transaction.
        let requeuedCount = try await store.requeueFailedTransfers(for: runID)
        #if DEBUG
        AppLog.write("[Sync] requeued run=\(runID.uuidString) transfers=\(requeuedCount)")
        #endif
        guard !pausedRuns.contains(runID) else { try await finish(runID); return }
        run = await store.run(runID) ?? run
        run.parallelism = requestedParallelism
        applySummary(to: &run, transfers: await store.transfers(for: runID))
        run.state = .running; run.updatedAt = Date(); try await store.save(run: run)
        let setupRemote = makeRemote()
        do {
            #if DEBUG
            AppLog.write("[Sync] connecting run=\(runID.uuidString) share=\(profile.share) destination=\(run.destinationPath)")
            #endif
            try await setupRemote.connect(profile: profile, password: password)
            try await setupRemote.createDirectory(path: run.destinationPath)
            try await setupRemote.createDirectory(path: ".picsync/objects")
            await setupRemote.disconnect()
        } catch {
            #if DEBUG
            AppLog.write("[Sync] setup failed run=\(runID.uuidString) error=\(String(reflecting: error))")
            #endif
            try await failPending(runID, message: error.localizedDescription)
            try await finish(runID)
            throw error
        }
        guard !pausedRuns.contains(runID) else { try await finish(runID); return }
        let transfers = await store.transfers(for: runID).filter { $0.state == .queued || $0.state == .staged }
        reservedPaths[runID] = Set(transfers.flatMap { $0.manifest.compactMap(\.finalPath) })
        let workerCount = min(run.parallelism, transfers.count)
        #if DEBUG
        AppLog.write("[Sync] scheduling run=\(runID.uuidString) transfers=\(transfers.count) requestedWorkers=\(requestedParallelism) workers=\(workerCount)")
        #endif
        let queue = TransferWorkQueue(transfers)
        workerCounts[runID] = workerCount
        try await updateWorkerCount(runID)
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<workerCount {
                group.addTask {
                    await self.work(queue: queue, runID: runID, profile: profile, password: password)
                    await self.workerFinished(runID)
                }
            }
        }
        try await finish(runID)
    }

    private func work(queue: TransferWorkQueue, runID: UUID, profile: ServerProfile, password: String?) async {
        let remote = makeRemote()
        do {
            try await remote.connect(profile: profile, password: password)
        } catch {
            #if DEBUG
            AppLog.write("[Sync] worker connection failed run=\(runID.uuidString) error=\(String(reflecting: error))")
            #endif
            await remote.disconnect()
            try? await failPending(runID, message: error.localizedDescription)
            return
        }
        while !isPaused(runID), let transfer = await queue.next() {
            guard !isPaused(runID) else { break }
            let succeeded = await process(transfer, runID: runID, remote: remote)
            if !succeeded, !isPaused(runID) {
                await remote.disconnect()
                do {
                    try await remote.connect(profile: profile, password: password)
                } catch {
                    #if DEBUG
                    AppLog.write("[Sync] worker reconnect failed run=\(runID.uuidString) error=\(String(reflecting: error))")
                    #endif
                    break
                }
            }
        }
        await remote.disconnect()
    }

    private func process(_ original: AssetTransfer, runID: UUID, remote: any RemoteFileService) async -> Bool {
        guard !pausedRuns.contains(runID) else { return true }
        var transfer = original
        var lockedFingerprint: String?
        do {
            if transfer.state == .queued {
                transfer.state = .exporting; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                let asset = try photoLibrary.asset(for: transfer.localIdentifier)
                transfer.manifest = try await exporter.stage(asset: asset, runID: runID, transferID: transfer.id)
                transfer.fingerprint = ContentHasher.assetFingerprint(transfer.manifest)
                transfer.state = .staged; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                try await updateRunningSummary(runID)
            }
            guard let fingerprint = transfer.fingerprint else { throw PicSyncError.sourceUnavailable }
            await fingerprintGate.acquire(fingerprint)
            lockedFingerprint = fingerprint
            let recordPath = ".picsync/objects/\(fingerprint.prefix(2))/\(fingerprint).json"
            if try await isValidContentRecord(path: recordPath, fingerprint: fingerprint, remote: remote) {
                transfer.state = .skippedDuplicate
                transfer.updatedAt = Date()
                try await store.save(transfer: transfer)
                try await updateRunningSummary(runID)
                cleanupStaging(for: transfer)
                await fingerprintGate.release(fingerprint)
                return true
            }
            transfer.state = .uploading; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            for index in transfer.manifest.indices {
                var resource = transfer.manifest[index]
                if let final = resource.finalPath,
                   (try await remote.stat(path: final))?.byteCount == resource.byteCount {
                    continue
                }
                let final: String
                if let existing = resource.finalPath {
                    final = existing
                } else {
                    final = try await availableName(resource.filename, hash: resource.sha256, directory: await runDestination(runID), runID: runID, remote: remote)
                }
                let temporary = resource.temporaryPath ?? join(remoteDirectory(final), ".\(URL(fileURLWithPath: final).lastPathComponent).picsync-\(transfer.id.uuidString).partial")
                resource.finalPath = final; resource.temporaryPath = temporary; transfer.manifest[index] = resource
                try await store.save(transfer: transfer)
                if try await remote.stat(path: temporary) != nil { try await remote.delete(path: temporary) }
                try await remote.upload(file: URL(fileURLWithPath: resource.stagingPath), to: temporary) { _ in }
                guard (try await remote.stat(path: temporary))?.byteCount == resource.byteCount else { throw CocoaError(.fileReadCorruptFile) }
            }
            transfer.state = .committing; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            for resource in transfer.manifest {
                guard let final = resource.finalPath, let temporary = resource.temporaryPath else { throw PicSyncError.sourceUnavailable }
                if (try await remote.stat(path: final))?.byteCount != resource.byteCount {
                    try await remote.rename(from: temporary, to: final)
                }
            }
            transfer.state = .indexing; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            try await commitContentRecord(for: transfer, runID: runID, remote: remote)
            transfer.state = .completed; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            try await updateRunningSummary(runID)
            cleanupStaging(for: transfer)
            await fingerprintGate.release(fingerprint)
            return true
        } catch {
            if let lockedFingerprint { await fingerprintGate.release(lockedFingerprint) }
            #if DEBUG
            let paths = transfer.manifest.compactMap(\.finalPath).joined(separator: ",")
            AppLog.write("[Sync] asset failed transfer=\(transfer.id.uuidString) state=\(transfer.state.rawValue) paths=\(paths) error=\(String(reflecting: error))")
            #endif
            transfer.state = .failed; transfer.attempts += 1; transfer.errorMessage = error.localizedDescription; transfer.updatedAt = Date(); try? await store.save(transfer: transfer)
            try? await updateRunningSummary(runID)
            return false
        }
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
    private func runDestination(_ runID: UUID) async -> String { await store.run(runID).map { RemotePath.normalize("\($0.destinationPath)/") } ?? "" }
    private func availableName(_ name: String, hash: String, directory: String, runID: UUID, remote: any RemoteFileService) async throws -> String {
        let candidates = [join(directory, name)] + (0...32).map { join(directory, SafeFilename.collisionName(for: name, hash: hash, attempt: $0)) }
        for candidate in candidates where !(reservedPaths[runID]?.contains(candidate) ?? false) {
            if try await remote.stat(path: candidate) == nil,
               !(reservedPaths[runID]?.contains(candidate) ?? false) {
                reservedPaths[runID, default: []].insert(candidate)
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
        try await remote.upload(file: localURL, to: temporaryPath) { _ in }
        try await remote.rename(from: temporaryPath, to: recordPath)
    }
    private func isValidContentRecord(path: String, fingerprint: String, remote: any RemoteFileService) async throws -> Bool {
        guard let item = try await remote.stat(path: path), item.byteCount > 0, item.byteCount <= 1_048_576 else { return false }
        let data = try await remote.read(path: path)
        guard let record = try? JSONDecoder().decode(RemoteContentRecord.self, from: data),
              record.schemaVersion == 1,
              record.fingerprint == fingerprint else { return false }
        for resource in record.resources {
            guard let finalPath = resource.finalPath,
                  (try await remote.stat(path: finalPath))?.byteCount == resource.byteCount else { return false }
        }
        return true
    }
    private func join(_ directory: String, _ name: String) -> String { [directory, name].filter { !$0.isEmpty }.joined(separator: "/") }
    private func remoteDirectory(_ path: String) -> String { path.split(separator: "/").dropLast().joined(separator: "/") }
    private func failPending(_ runID: UUID, message: String) async throws {
        for var transfer in await store.transfers(for: runID) where !transfer.state.isTerminal {
            transfer.state = .failed; transfer.errorMessage = message; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
        }
    }
    private func finish(_ runID: UUID) async throws {
        guard var run = await store.run(runID) else { return }
        let transfers = await store.transfers(for: runID)
        applySummary(to: &run, transfers: transfers)
        let hasPending = transfers.contains { !$0.state.isTerminal }
        if hasPending {
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
    private func updateRunningSummary(_ runID: UUID) async throws {
        let transfers = await store.transfers(for: runID)
        guard var run = await store.run(runID) else { return }
        applySummary(to: &run, transfers: transfers)
        run.updatedAt = Date()
        try await store.save(run: run)
    }

    private func applySummary(to run: inout SyncRun, transfers: [AssetTransfer]) {
        run.activeWorkerCount = workerCounts[run.id] ?? 0
        run.completedCount = transfers.filter { $0.state == .completed }.count
        run.skippedCount = transfers.filter { $0.state == .skippedDuplicate }.count
        run.failedCount = transfers.filter { $0.state == .failed }.count
        run.totalBytes = transfers.flatMap(\.manifest).reduce(0) { $0 + $1.byteCount }
        run.completedBytes = transfers.filter { $0.state == .completed || $0.state == .skippedDuplicate }
            .flatMap(\.manifest).reduce(0) { $0 + $1.byteCount }
    }

    private func cleanupStaging(for transfer: AssetTransfer) {
        guard let path = transfer.manifest.first?.stagingPath else { return }
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: path).deletingLastPathComponent())
    }
}

actor TransferWorkQueue {
    private let transfers: [AssetTransfer]
    private var index = 0

    init(_ transfers: [AssetTransfer]) { self.transfers = transfers }

    func next() -> AssetTransfer? {
        guard index < transfers.count else { return nil }
        defer { index += 1 }
        return transfers[index]
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
        didSet { UIApplication.shared.isIdleTimerDisabled = !activeRunIDs.isEmpty }
    }
    private(set) var transferItemsByRun = [UUID: [AssetTransfer]]()
    var presentsPhotoSelection = false
    var parallelism: Int {
        didSet { UserDefaults.standard.set(parallelism, forKey: "parallelism") }
    }
    var isShowingError: Bool { errorMessage != nil }

    init() {
        let store = SyncStore()
        self.store = store
        coordinator = SyncCoordinator(store: store)
        let savedParallelism = UserDefaults.standard.integer(forKey: "parallelism")
        parallelism = (1...20).contains(savedParallelism) ? savedParallelism : 2
    }

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        do {
            try await store.load()
            profiles = await store.profiles()
            let activeProfileID = await store.activeProfileID()
            profile = profiles.first { $0.id == activeProfileID } ?? profiles.first
            if let profile, activeProfileID != profile.id { try await store.selectProfile(profile.id) }
            runs = await store.runs()
            if let profile { hasSavedPassword = (try CredentialStore.password(profileID: profile.id)) != nil }
        } catch {
            hasLoaded = false
            show(error)
        }
    }
    func refresh() async { runs = await store.runs() }
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
        profiles = await store.profiles()
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
    func createRun(identifiers: [String], destinationPath: String, parallelism: Int) async throws -> SyncRun { guard let profile else { throw PicSyncError.invalidServerAddress }; guard !identifiers.isEmpty else { throw PicSyncError.sourceUnavailable }; let run = try await coordinator.createRun(itemIdentifiers: identifiers, profile: profile, destinationPath: destinationPath, parallelism: parallelism); runs = await store.runs(); return run }
    func createAlbumRun(_ album: PhotoAlbum, destinationPath: String, parallelism: Int) async throws -> SyncRun { guard let profile else { throw PicSyncError.invalidServerAddress }; let identifiers = try PhotoLibraryService().assetIdentifiers(forAlbumID: album.id); guard !identifiers.isEmpty else { throw PicSyncError.sourceUnavailable }; let run = try await coordinator.createRun(itemIdentifiers: identifiers, profile: profile, destinationPath: destinationPath, parallelism: parallelism, sourceLabel: album.title); runs = await store.runs(); return run }
    func pause(runID: UUID) async {
        if let index = runs.firstIndex(where: { $0.id == runID }) { runs[index].state = .pausing }
        do { try await coordinator.pause(runID); runs = await store.runs() } catch { show(error) }
    }
    func delete(runID: UUID) async -> Bool {
        guard !activeRunIDs.contains(runID) else { show(PicSyncError.runActive); return false }
        do {
            try await coordinator.delete(runID)
            transferItemsByRun[runID] = nil
            runs = await store.runs()
            return true
        } catch {
            show(error)
            return false
        }
    }
    func loadTransfers(runID: UUID) async { transferItemsByRun[runID] = await store.transfers(for: runID) }
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
            try await coordinator.run(runID, profile: profile, password: password, parallelism: parallelism)
            runs = await store.runs()
            transferItemsByRun[runID] = await store.transfers(for: runID)
        } catch {
            #if DEBUG
            AppLog.write("[Sync] resume failed run=\(runID.uuidString) error=\(String(reflecting: error))")
            #endif
            runs = await store.runs()
            transferItemsByRun[runID] = await store.transfers(for: runID)
            show(error)
        }
    }
    func show(_ error: Error) {
        AppLog.write("[Error] \(String(reflecting: error))")
        errorMessage = error.localizedDescription
    }
}
