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
    private let stageFromCloud: Stage?
    private let makeRemote: @Sendable () -> any RemoteFileService
    private let fingerprintGate = FingerprintGate()
    private let recordDirectoryGate = FingerprintGate()
    private var exportSlots = [UUID: ExportSlots]()
    private var pausedRuns = Set<UUID>()
    private var activeRuns = Set<UUID>()
    private var workerCounts = [UUID: Int]()
    private var runtimes = [UUID: TransferRuntime]()
    private var budgets = [UUID: StagingBudget]()
    private var ensuredDirectories = [UUID: Set<String>]()
    private var activeDownloaders = [UUID: Int]()
    private let stagingRoot: URL

    /// Without a custom `stage`, exports come from the Photos library in two lanes: originals already on
    /// the device, and originals that have to be downloaded from iCloud first.
    init(store: SyncStore, stagingRoot: URL? = nil, makeRemote: @escaping @Sendable () -> any RemoteFileService = { SMBRemoteFileService() }, stage: Stage? = nil) {
        self.store = store
        self.makeRemote = makeRemote
        if let stage {
            self.stage = stage
            stageFromCloud = nil
        } else {
            self.stage = { identifier, runID, transferID, budget, runtime in
                let asset = try PhotoLibraryService().asset(for: identifier)
                return try await PhotoResourceExporter().stage(asset: asset, runID: runID, transferID: transferID, budget: budget, runtime: runtime, allowNetwork: false)
            }
            stageFromCloud = { identifier, runID, transferID, budget, runtime in
                let asset = try PhotoLibraryService().asset(for: identifier)
                return try await PhotoResourceExporter().stage(asset: asset, runID: runID, transferID: transferID, budget: budget, runtime: runtime, allowNetwork: true)
            }
        }
        self.stagingRoot = stagingRoot ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Transfers", isDirectory: true)
    }

    /// `subfolders` files an identifier below the destination; `skipBackedUp` trusts the on-phone checklist
    /// and leaves items it already covers out of the queue entirely. `albums` names the album folders each
    /// identifier belongs in; a backed-up item stays queued only while it still has album links to make.
    func createRun(itemIdentifiers: [String], profile: ServerProfile, destinationPath: String, parallelism: Int, sourceLabel: String = "Selected Photos", subfolders: [String: String] = [:], albums: [String: [String]] = [:], skipBackedUp: Bool = false) async throws -> SyncRun {
        let now = Date()
        let run = SyncRun(id: UUID(), sourceLabel: sourceLabel, assetIdentifiers: itemIdentifiers, profileID: profile.id, share: profile.share, destinationPath: RemotePath.normalize(destinationPath), parallelism: min(max(parallelism, 1), 20), activeWorkerCount: 0, state: .preparing, createdAt: now, updatedAt: now, completedBytes: 0, totalBytes: 0, completedCount: 0, skippedCount: 0, failedCount: 0)
        let backedUp = skipBackedUp ? try await store.backedUpIdentifiers(destination: profile.ledgerDestination) : []
        let linked = skipBackedUp && !albums.isEmpty ? try await store.linkedAlbums(destination: Self.linkDestination(profile.ledgerDestination, folder: run.destinationPath)) : [:]
        var remainingAlbums = [String: [String]]()
        for (identifier, names) in albums {
            let remaining = names.filter { linked[identifier]?.contains($0) != true }
            if !remaining.isEmpty { remainingAlbums[identifier] = remaining }
        }
        let pending = backedUp.isEmpty ? itemIdentifiers : itemIdentifiers.filter { !backedUp.contains($0) || remainingAlbums[$0] != nil }
        let transfers = pending.map { AssetTransfer(id: UUID(), runID: run.id, localIdentifier: $0, state: .queued, manifest: [], fingerprint: nil, attempts: 0, errorMessage: nil, updatedAt: now, subfolder: subfolders[$0], albums: remainingAlbums[$0]) }
        try await store.save(run: run, transfers: transfers, alreadyBackedUp: itemIdentifiers.count - pending.count)
        AppLog.write("[Sync] created run=\(run.id.uuidString) source=\(sourceLabel) items=\(itemIdentifiers.count) alreadyBackedUp=\(itemIdentifiers.count - pending.count) destination=\(run.destinationPath)")
        return try await store.run(run.id) ?? run
    }

    /// `reason` is shown on the run, for pauses the user did not ask for.
    func pause(_ runID: UUID, reason: String? = nil) async throws {
        pausedRuns.insert(runID)
        runtimes[runID]?.pause()
        guard let existingRun = try await store.run(runID) else { return }
        guard ![.completed, .completedWithErrors, .cancelled].contains(existingRun.state) else { return }
        let hasPending = try await store.hasPending(runID)
        guard hasPending else { return }
        guard var run = try await store.run(runID) else { return }
        run.state = activeRuns.contains(runID) ? .pausing : .paused
        if let reason { run.pauseReason = run.pauseReason ?? reason }
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

    func run(_ runID: UUID, profile: ServerProfile, password: String?, parallelism: Int, stagingLimit: Int64 = 8 * 1_024 * 1_024 * 1_024, cloudDownloads: Int = 3) async throws {
        guard activeRuns.isEmpty else { return }
        activeRuns.insert(runID)
        pausedRuns.remove(runID)
        defer {
            activeRuns.remove(runID)
            workerCounts[runID] = nil
            runtimes[runID] = nil
            budgets[runID] = nil
            ensuredDirectories[runID] = nil
            activeDownloaders[runID] = nil
            exportSlots[runID] = nil
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
        // One export stream reads from the Photos library at roughly half a gigabit, so every worker
        // exports for itself. Each still holds only its own item, so staging use is bounded by the
        // worker count either way. A custom stage keeps the strictly serial behaviour.
        exportSlots[runID] = ExportSlots(stageFromCloud == nil ? 1 : workerCount)
        // The workers are sized to saturate the server. Downloading from iCloud uses a different link,
        // so it gets its own pool which only stages originals; the workers then upload them like any other.
        let downloaderCount = stageFromCloud == nil ? 0 : min(max(cloudDownloads, 1), 16)
        activeDownloaders[runID] = downloaderCount
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<workerCount {
                group.addTask {
                    await self.work(runID: runID, profile: profile, password: password)
                    await self.workerFinished(runID)
                }
            }
            for _ in 0..<downloaderCount {
                group.addTask { await self.download(runID: runID) }
            }
        }
        try await finish(runID)
    }

    /// Pulls iCloud-only originals onto the phone and leaves them staged for the upload workers.
    private func download(runID: UUID) async {
        defer { activeDownloaders[runID] = max((activeDownloaders[runID] ?? 1) - 1, 0) }
        guard let stageFromCloud, let runtime = runtimes[runID], let budget = budgets[runID] else { return }
        while !isPaused(runID) {
            do {
                guard var transfer = try await store.claimCloud(runID) else {
                    // Workers may still be discovering that queued originals are in iCloud.
                    guard try await store.hasUnclassified(runID) else { return }
                    try await Task.sleep(for: .milliseconds(500))
                    continue
                }
                do {
                    try runtime.check()
                    runtime.update(transfer.id, filename: "Photo item", phase: "Downloading original from iCloud", download: true)
                    let resources = try await stageFromCloud(transfer.localIdentifier, runID, transfer.id, budget, runtime)
                    guard !resources.isEmpty else { throw PicSyncError.sourceUnavailable }
                    budget.beginDraining(transfer.id)
                    transfer.manifest = resources
                    transfer.fingerprint = ContentHasher.assetFingerprint(resources)
                    transfer.state = .staged; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                    runtime.remove(transfer.id)
                } catch {
                    #if DEBUG
                    AppLog.write("[Sync] iCloud download failed transfer=\(transfer.id.uuidString) error=\(String(reflecting: error))")
                    #endif
                    transfer.state = isPaused(runID) ? transfer.requeuedState : .failed
                    transfer.attempts += 1; transfer.errorMessage = error.localizedDescription; transfer.updatedAt = Date()
                    try await store.save(transfer: transfer)
                    runtime.remove(transfer.id)
                    // Several downloads can outrun the staging budget; that fails one item, not the run.
                    if !isPaused(runID), TransferFailurePolicy.isDestinationWide(error), !Self.isStagingLimit(error) {
                        try await stopRun(runID, reason: error.localizedDescription)
                    }
                }
            } catch {
                if !isPaused(runID) { try? await stopRun(runID, reason: error.localizedDescription) }
                return
            }
        }
    }
    private static func isStagingLimit(_ error: Error) -> Bool {
        if case TransferError.stagingLimit = error { return true }
        return false
    }

    private func work(runID: UUID, profile: ServerProfile, password: String?) async {
        let remote = makeRemote()
        do {
            try await connect(remote, runID: runID, profile: profile, password: password)
            while !isPaused(runID) {
                guard let transfer = try await store.claimNext(runID) else {
                    // Nothing to upload right now, but the download pool may still stage more.
                    guard (activeDownloaders[runID] ?? 0) > 0 else { break }
                    try await Task.sleep(for: .milliseconds(500))
                    continue
                }
                // The claim is durable. Even a pause between claim and processing is recovered.
                var attempt = 0
                while true {
                    do {
                        try await process(transfer, runID: runID, remote: remote, destination: profile.ledgerDestination)
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

    private func process(_ original: AssetTransfer, runID: UUID, remote: any RemoteFileService, destination: String) async throws {
        guard let runtime = runtimes[runID], let budget = budgets[runID] else { throw TransferError.paused }
        var transfer = try await store.transfer(original.id) ?? original
        var lockedFingerprint: String?
        defer { budget.endDraining(transfer.id) }
        do {
            try runtime.check()
            // A fingerprint remembered from an earlier sync answers the duplicate question without exporting.
            if transfer.manifest.isEmpty, let known = try await store.knownFingerprint(transfer.localIdentifier) {
                runtime.update(transfer.id, filename: "Photo item", phase: "Checking server index")
                if let record = try await validContentRecord(path: ".picsync/objects/\(known.prefix(2))/\(known).json", fingerprint: known, remote: remote) {
                    try await linkIntoAlbums(transfer, resources: record.resources, runID: runID, remote: remote, destination: destination)
                    transfer.fingerprint = known
                    transfer.state = .skippedDuplicate
                    transfer.updatedAt = Date()
                    try await store.save(transfer: transfer)
                    try await store.markBackedUp(transfer.localIdentifier, destination: destination)
                    return
                }
            }
            runtime.update(transfer.id, filename: transfer.manifest.first?.filename ?? "Photo item", phase: "Checking staged original")
            if try await !SyncStore.hasValidStaging(transfer.manifest, runtime: runtime) {
                transfer.state = .exporting; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                let previous = transfer.manifest
                let staged: [ResourceManifest]
                do {
                    // Finding out by attempting the export would hold the single export slot for every
                    // iCloud-only item, starving the originals that are ready to upload.
                    if stageFromCloud != nil, PhotoLibraryService().originalsAreLocal(transfer.localIdentifier) == false { throw NeedsNetworkError() }
                    staged = try await stageOriginal(transfer, runID: runID, budget: budget, runtime: runtime)
                } catch is NeedsNetworkError {
                    // Not a failure: hand it to the download pool and take the next local item.
                    transfer.needsNetwork = true
                    transfer.state = .queuedCloud; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                    return
                } catch TransferError.stagingLimit where stageFromCloud != nil && transfer.attempts < 3 {
                    // Several exports at once can fill staging between them. Give the space back and
                    // try again shortly instead of stopping the run.
                    transfer.attempts += 1
                    transfer.state = transfer.requeuedState; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                    try await Task.sleep(for: .seconds(2))
                    return
                }
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
            try await store.recordFingerprint(fingerprint, identifier: transfer.localIdentifier)
            await fingerprintGate.acquire(fingerprint)
            lockedFingerprint = fingerprint
            try runtime.check()
            let recordPath = ".picsync/objects/\(fingerprint.prefix(2))/\(fingerprint).json"
            if let record = try await validContentRecord(path: recordPath, fingerprint: fingerprint, remote: remote) {
                try await linkIntoAlbums(transfer, resources: record.resources, runID: runID, remote: remote, destination: destination)
                transfer.state = .skippedDuplicate
                transfer.updatedAt = Date()
                try await store.save(transfer: transfer)
                try await store.markBackedUp(transfer.localIdentifier, destination: destination)
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
                    let directory = join(try await runDestination(runID), transfer.subfolder ?? "")
                    if transfer.subfolder != nil { try await ensureDirectory(directory, runID: runID, remote: remote) }
                    final = try await availableName(resource.filename, hash: resource.sha256, directory: directory, runID: runID, remote: remote)
                }
                var temporary = resource.temporaryPath ?? join(remoteDirectory(final), ".picsync-\(transfer.id.uuidString)-\(index).partial")
                let file = URL(fileURLWithPath: resource.stagingPath)
                let id = transfer.id, name = resource.filename, size = resource.byteCount
                for attempt in 0...1 {
                    resource.finalPath = final; resource.temporaryPath = temporary; transfer.manifest[index] = resource
                    try await store.save(transfer: transfer)
                    do {
                        runtime.update(id, filename: name, phase: "Checking partial upload")
                        let offset = try await resumableOffset(resource: resource, remote: remote, runtime: runtime)
                        runtime.update(id, filename: name, phase: "Uploading", bytes: offset, total: size)
                        if offset < size || size == 0 {
                            try await remote.upload(file: file, to: temporary, offset: offset) { bytes in
                                try runtime.check()
                                runtime.update(id, filename: name, phase: "Uploading", bytes: bytes, total: size)
                            }
                        }
                        break
                    } catch let error as ErrorResponse where error.header.status == 0xC0000043 && attempt == 0 {
                        // Sharing violation: a connection that died mid-upload (the app was killed) can keep
                        // its partial open on the server for minutes. Leave that file and start a new one.
                        AppLog.write("[Sync] partial is still open on the server, starting over transfer=\(id.uuidString) partial=\(temporary)")
                        temporary = join(remoteDirectory(final), ".picsync-\(id.uuidString)-\(index)-\(UUID().uuidString.prefix(8)).partial")
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
            try await linkIntoAlbums(transfer, resources: transfer.manifest, runID: runID, remote: remote, destination: destination)
            transfer.state = .completed; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            try await store.markBackedUp(transfer.localIdentifier, destination: destination)
            cleanupStaging(for: transfer, budget: budget)
            await fingerprintGate.release(fingerprint)
            return
        } catch {
            if let lockedFingerprint { await fingerprintGate.release(lockedFingerprint) }
            #if DEBUG
            let paths = transfer.manifest.compactMap(\.finalPath).joined(separator: ",")
            AppLog.write("[Sync] asset failed transfer=\(transfer.id.uuidString) state=\(transfer.state.rawValue) paths=\(paths) error=\(String(reflecting: error))")
            #endif
            transfer.state = isPaused(runID) ? transfer.requeuedState : .failed
            transfer.attempts += 1; transfer.errorMessage = error.localizedDescription; transfer.updatedAt = Date()
            try await store.save(transfer: transfer)
            throw error
        }
    }

    /// Exports an original that is on the device. One that is only in iCloud throws `NeedsNetworkError`.
    private func stageOriginal(_ transfer: AssetTransfer, runID: UUID, budget: StagingBudget, runtime: TransferRuntime) async throws -> [ResourceManifest] {
        // Limit exports, not uploads, so partially exported videos cannot exhaust the
        // budget while every worker waits for another exporter to release space.
        guard let slots = exportSlots[runID] else { throw TransferError.paused }
        runtime.update(transfer.id, filename: transfer.manifest.first?.filename ?? "Photo item", phase: "Waiting for its turn to export")
        await slots.acquire()
        do {
            try runtime.check()
            let resources = try await stage(transfer.localIdentifier, runID, transfer.id, budget, runtime)
            guard !resources.isEmpty else { throw PicSyncError.sourceUnavailable }
            budget.beginDraining(transfer.id)
            await slots.release()
            return resources
        } catch {
            await slots.release()
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
    /// Date folders are shared by every worker; create each once per run instead of once per photo.
    private func ensureDirectory(_ path: String, runID: UUID, remote: any RemoteFileService) async throws {
        guard ensuredDirectories[runID]?.contains(path) != true else { return }
        await recordDirectoryGate.acquire("directory:\(path)")
        do {
            try await remote.createDirectory(path: path)
            await recordDirectoryGate.release("directory:\(path)")
        } catch {
            await recordDirectoryGate.release("directory:\(path)")
            throw error
        }
        ensuredDirectories[runID, default: []].insert(path)
    }
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
        if try await validContentRecord(path: recordPath, fingerprint: fingerprint, remote: remote) != nil { return }
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
    private func validContentRecord(path: String, fingerprint: String, remote: any RemoteFileService) async throws -> RemoteContentRecord? {
        guard let item = try await remote.stat(path: path), item.byteCount > 0, item.byteCount <= 1_048_576 else { return nil }
        let data = try await remote.read(path: path)
        guard let record = try? JSONDecoder().decode(RemoteContentRecord.self, from: data),
              record.schemaVersion == 1,
              record.fingerprint == fingerprint,
              !record.resources.isEmpty,
              ContentHasher.assetFingerprint(record.resources) == fingerprint else { return nil }
        for resource in record.resources {
            guard let finalPath = resource.finalPath,
                  let item = try await remote.stat(path: finalPath),
                  !item.isDirectory, item.byteCount == resource.byteCount else { return nil }
        }
        return record
    }
    static func linkDestination(_ destination: String, folder: String) -> String { "\(destination)|\(RemotePath.normalize(folder))" }
    /// Gives the stored files a second name in each album folder. Nothing is copied: the album
    /// entry and the stored file are the same data on the server.
    private func linkIntoAlbums(_ transfer: AssetTransfer, resources: [ResourceManifest], runID: UUID, remote: any RemoteFileService, destination: String) async throws {
        guard let albums = transfer.albums, !albums.isEmpty else { return }
        let root = try await runDestination(runID)
        runtimes[runID]?.update(transfer.id, filename: resources.first?.filename ?? "Photo item", phase: "Linking into albums")
        for album in albums {
            let directory = join(join(root, "albums"), album)
            try await ensureDirectory(directory, runID: runID, remote: remote)
            for resource in resources {
                guard let stored = resource.finalPath else { throw PicSyncError.sourceUnavailable }
                let name = URL(fileURLWithPath: stored).lastPathComponent
                // The same name at the same size is this file from an earlier sync; a different size is
                // another photo that happens to share the name, so this one gets a hash suffix.
                let candidates = [name] + (0...8).map { SafeFilename.collisionName(for: name, hash: resource.sha256, attempt: $0) }
                var isLinked = false
                for candidate in candidates {
                    let target = join(directory, candidate)
                    if let existing = try await remote.stat(path: target) {
                        guard !existing.isDirectory, existing.byteCount == resource.byteCount else { continue }
                    } else {
                        try await remote.hardLink(from: stored, to: target)
                    }
                    isLinked = true
                    break
                }
                guard isLinked else { throw CocoaError(.fileWriteFileExists) }
            }
            try await store.markLinked(transfer.localIdentifier, album: album, destination: Self.linkDestination(destination, folder: root))
        }
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

/// A counting semaphore for concurrent exports from the Photos library.
actor ExportSlots {
    private var available: Int
    private var waiters = [CheckedContinuation<Void, Never>]()
    init(_ count: Int) { available = max(count, 1) }

    func acquire() async {
        if available > 0 { available -= 1; return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        if waiters.isEmpty { available += 1 } else { waiters.removeFirst().resume() }
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
    var profile: ServerProfile? {
        didSet { destinationFolder = profile.flatMap { UserDefaults.standard.string(forKey: Self.folderKey($0.id)) } }
    }
    /// Upload folder inside the active profile's share; nil until one has been chosen, "" for the share root.
    private(set) var destinationFolder: String?
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
    var parallelism: Int {
        didSet { UserDefaults.standard.set(parallelism, forKey: "parallelism") }
    }
    var stagingLimitGB: Int {
        didSet { UserDefaults.standard.set(stagingLimitGB, forKey: "stagingLimitGB") }
    }
    /// iCloud downloads running at once, separate from the upload workers.
    var cloudDownloads: Int {
        didSet { UserDefaults.standard.set(cloudDownloads, forKey: "cloudDownloads") }
    }
    private(set) var cloudQueueByRun = [UUID: Int]()
    private(set) var memoryMB = 0
    private var refreshCount = 0
    var organizeByDate: Bool {
        didSet { UserDefaults.standard.set(organizeByDate, forKey: "organizeByDate") }
    }
    var linkAlbums: Bool {
        didSet { UserDefaults.standard.set(linkAlbums, forKey: "linkAlbums") }
    }
    /// Ignore the on-phone checklist for the next sync and ask the server about every photo again.
    var recheckBackedUp = false
    private(set) var progressByRun = [UUID: TransferRuntime.Snapshot]()
    var isShowingError: Bool { errorMessage != nil }
    private static func folderKey(_ profileID: UUID) -> String { "destinationFolder.\(profileID.uuidString)" }

    init() {
        let store = SyncStore()
        self.store = store
        coordinator = SyncCoordinator(store: store)
        let savedParallelism = UserDefaults.standard.integer(forKey: "parallelism")
        parallelism = (1...20).contains(savedParallelism) ? savedParallelism : 2
        let savedLimit = UserDefaults.standard.integer(forKey: "stagingLimitGB")
        stagingLimitGB = (2...128).contains(savedLimit) ? savedLimit : 8
        let savedDownloads = UserDefaults.standard.integer(forKey: "cloudDownloads")
        cloudDownloads = (1...16).contains(savedDownloads) ? savedDownloads : 3
        organizeByDate = UserDefaults.standard.object(forKey: "organizeByDate") as? Bool ?? true
        linkAlbums = UserDefaults.standard.object(forKey: "linkAlbums") as? Bool ?? true
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
        memoryMB = AppMemory.megabytes
        refreshCount += 1
        // A memory kill leaves no trace in the app, so keep a trail while a sync runs.
        if !activeRunIDs.isEmpty, refreshCount % 5 == 0 { AppLog.write("[Memory] footprint=\(memoryMB) MB") }
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
            connectionStatus = "Connected as \(candidate.username)."
            return shares
        } catch {
            await remote.disconnect()
            connectionStatus = error.localizedDescription
            throw error
        }
    }
    func shares(of profile: ServerProfile) async throws -> [String] {
        let credential = try CredentialStore.password(profileID: profile.id)
        guard let credential, !credential.isEmpty else { throw PicSyncError.passwordRequired }
        var server = profile
        server.share = ""
        let connectionProfile = server
        let remote = SMBRemoteFileService()
        do {
            let shares = try await withConnectionTestTimeout {
                try await remote.connect(profile: connectionProfile, password: credential)
                return try await remote.listShares()
            }
            await remote.disconnect()
            return shares
        } catch {
            await remote.disconnect()
            throw error
        }
    }
    /// Runs resume against their profile's share, so picking a different share never rewrites a profile that already has one.
    func useDestination(share: String, folder: String) async throws {
        guard var target = profile else { throw PicSyncError.invalidServerAddress }
        if target.share != share {
            let password = try CredentialStore.password(profileID: target.id)
            let now = Date()
            if let sibling = profiles.first(where: { $0.isSameServer(as: target) && $0.share == share && $0.requiresSigning == target.requiresSigning }) {
                target = sibling
            } else if target.share.isEmpty {
                target.share = share
            } else {
                target.id = UUID()
                target.share = share
                target.createdAt = now
            }
            target.updatedAt = now
            if let password { try CredentialStore.save(password, profileID: target.id) }
            try await store.save(profile: target)
            try await store.selectProfile(target.id)
            profile = target
            profiles = try await store.profiles()
        }
        let folder = RemotePath.normalize(folder)
        UserDefaults.standard.set(folder, forKey: Self.folderKey(target.id))
        destinationFolder = folder
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
    /// Uploads a small file and adds a second name for it. Both are left in `.picsync/linktest`
    /// so the link count can be inspected on the server.
    func testHardLinks() async -> String {
        guard let profile, !profile.share.isEmpty else { return "Choose a server and share first." }
        let remote = SMBRemoteFileService()
        let original = ".picsync/linktest/original.txt", linked = ".picsync/linktest/linked.txt"
        let local = FileManager.default.temporaryDirectory.appendingPathComponent("picsync-linktest-\(UUID().uuidString).txt")
        defer { try? FileManager.default.removeItem(at: local) }
        let result: String
        do {
            guard let credential = try CredentialStore.password(profileID: profile.id), !credential.isEmpty else { throw PicSyncError.passwordRequired }
            let content = Data("PicSync hard link test \(Date().ISO8601Format())\n".utf8)
            try content.write(to: local)
            try await remote.connect(profile: profile, password: credential)
            try await remote.createDirectory(path: ".picsync/linktest")
            for path in [original, linked] where try await remote.stat(path: path) != nil { try await remote.delete(path: path) }
            try await remote.upload(file: local, to: original, offset: 0) { _ in }
            try await remote.hardLink(from: original, to: linked)
            let readBack = try await remote.read(path: linked)
            result = readBack == content ? "Hard link created on \(profile.share) and read back correctly." : "Hard link was created but its content does not match."
        } catch {
            result = "Hard link test failed: \(String(reflecting: error))"
        }
        await remote.disconnect()
        AppLog.write("[LinkTest] \(result)")
        return result
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
    func createRun(identifiers: [String], destinationPath: String, parallelism: Int) async throws -> SyncRun {
        try await makeRun(identifiers: identifiers, sourceLabel: "Selected Photos", destinationPath: destinationPath, parallelism: parallelism)
    }
    func createAlbumRun(_ album: PhotoAlbum, destinationPath: String, parallelism: Int) async throws -> SyncRun {
        guard !album.isCloudShared else { throw PicSyncError.sharedAlbumOriginalUnavailable }
        return try await makeRun(identifiers: try PhotoLibraryService().assetIdentifiers(forAlbumID: album.id), sourceLabel: album.title, destinationPath: destinationPath, parallelism: parallelism)
    }
    private func makeRun(identifiers: [String], sourceLabel: String, destinationPath: String, parallelism: Int) async throws -> SyncRun {
        guard let profile else { throw PicSyncError.invalidServerAddress }
        guard !identifiers.isEmpty else { throw PicSyncError.sourceUnavailable }
        try PhotoLibraryService().validateOriginalAvailability(for: identifiers)
        let subfolders = organizeByDate ? PhotoLibraryService().dateFolders(for: identifiers) : [:]
        let albums = linkAlbums ? PhotoLibraryService().albumFolders(for: identifiers) : [:]
        let run = try await coordinator.createRun(itemIdentifiers: identifiers, profile: profile, destinationPath: destinationPath, parallelism: parallelism, sourceLabel: sourceLabel, subfolders: subfolders, albums: albums, skipBackedUp: !recheckBackedUp)
        runs = try await store.runs()
        return run
    }
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
        do {
            transferItemsByRun[runID] = try await store.transfers(for: runID, state: .failed, limit: 5)
            cloudQueueByRun[runID] = try await store.cloudQueueCount(runID)
        }
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
        let coordinator = coordinator
        let background = BackgroundSyncTask.begin(title: "PicSync: \(run.sourceLabel)") {
            Task { try? await coordinator.pause(runID, reason: "Paused when iOS stopped the sync in the background. Resume to continue.") }
        }
        let network = LocalNetworkWatch { reason in
            AppLog.write("[Network] pausing run=\(runID.uuidString)")
            Task { try? await coordinator.pause(runID, reason: reason) }
        }
        let reporter = Task { [store] in
            while !Task.isCancelled {
                if let run = try? await store.run(runID) {
                    let done = run.completedCount + run.skippedCount + run.failedCount
                    let speed = await coordinator.progress(runID).map { ($0.bytesPerSecond + $0.downloadBytesPerSecond) / 1_048_576 } ?? 0
                    background?.update(done: Int64(done), total: Int64(run.itemCount), subtitle: "\(done.formatted()) of \(run.itemCount.formatted()) · \(String(format: "%.1f", speed)) MB/s")
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
        defer {
            activeRunIDs.remove(runID)
            reporter.cancel()
            network.stop()
            background?.finish(success: true)
        }
        #if DEBUG
        AppLog.write("[Sync] resume button run=\(runID.uuidString) profile=\(profile.id.uuidString)")
        #endif
        do {
            try await coordinator.run(runID, profile: profile, password: password, parallelism: parallelism, stagingLimit: Int64(stagingLimitGB) * 1_024 * 1_024 * 1_024, cloudDownloads: cloudDownloads)
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
