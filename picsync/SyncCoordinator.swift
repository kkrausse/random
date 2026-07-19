import Foundation
import Observation
import PhotosUI
import SwiftUI

actor SyncCoordinator {
    private let store: SyncStore
    private let photoLibrary = PhotoLibraryService()
    private let exporter = PhotoResourceExporter()
    private let makeRemote: @Sendable () -> any RemoteFileService
    private var pausedRuns = Set<UUID>()

    init(store: SyncStore, makeRemote: @escaping @Sendable () -> any RemoteFileService = { SMBRemoteFileService() }) {
        self.store = store
        self.makeRemote = makeRemote
    }

    func createRun(itemIdentifiers: [String], profile: ServerProfile, parallelism: Int, sourceLabel: String = "Selected Photos") async throws -> SyncRun {
        let now = Date()
        let run = SyncRun(id: UUID(), sourceLabel: sourceLabel, assetIdentifiers: itemIdentifiers, profileID: profile.id, share: profile.share, destinationPath: profile.destinationPath, parallelism: parallelism, state: .preparing, createdAt: now, updatedAt: now, completedBytes: 0, totalBytes: 0, completedCount: 0, skippedCount: 0, failedCount: 0)
        let transfers = itemIdentifiers.map { AssetTransfer(id: UUID(), runID: run.id, localIdentifier: $0, state: .queued, manifest: [], fingerprint: nil, attempts: 0, errorMessage: nil, updatedAt: now) }
        try await store.save(run: run, transfers: transfers)
        return run
    }

    func pause(_ runID: UUID) async throws { pausedRuns.insert(runID); guard var run = await store.run(runID) else { return }; run.state = .paused; run.updatedAt = Date(); try await store.save(run: run) }

    func retryFailed(_ runID: UUID) async throws {
        for var transfer in await store.transfers(for: runID) where transfer.state == .failed { transfer.state = .queued; transfer.errorMessage = nil; transfer.updatedAt = Date(); try await store.save(transfer: transfer) }
    }

    func run(_ runID: UUID, profile: ServerProfile, password: String?) async throws {
        guard var run = await store.run(runID) else { return }
        #if DEBUG
        print("[PicSync Sync] resume run=\(runID.uuidString) state=\(run.state.rawValue)")
        #endif
        pausedRuns.remove(runID)
        // An explicit Resume is also the user's request to retry failed records in one journal transaction.
        let requeuedCount = try await store.requeueFailedTransfers(for: runID)
        #if DEBUG
        print("[PicSync Sync] requeued run=\(runID.uuidString) transfers=\(requeuedCount)")
        #endif
        run.state = .running; run.updatedAt = Date(); try await store.save(run: run)
        let setupRemote = makeRemote()
        do {
            #if DEBUG
            print("[PicSync Sync] connecting run=\(runID.uuidString) share=\(profile.share) destination=\(run.destinationPath)")
            #endif
            try await setupRemote.connect(profile: profile, password: password)
            try await setupRemote.createDirectory(path: run.destinationPath)
            await setupRemote.disconnect()
        } catch {
            #if DEBUG
            print("[PicSync Sync] setup failed run=\(runID.uuidString) error=\(String(reflecting: error))")
            #endif
            try await failPending(runID, message: error.localizedDescription)
            try await finish(runID)
            throw error
        }
        let transfers = await store.transfers(for: runID).filter { $0.state == .queued || $0.state == .staged }
        #if DEBUG
        print("[PicSync Sync] scheduling run=\(runID.uuidString) transfers=\(transfers.count)")
        #endif
        var iterator = transfers.makeIterator()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<min(run.parallelism, 20) {
                guard let transfer = iterator.next() else { break }
                group.addTask { await self.process(transfer, runID: runID, profile: profile, password: password) }
            }
            while await group.next() != nil {
                if let transfer = iterator.next(), !self.isPaused(runID) { group.addTask { await self.process(transfer, runID: runID, profile: profile, password: password) } }
            }
        }
        try await finish(runID)
    }

    private func process(_ original: AssetTransfer, runID: UUID, profile: ServerProfile, password: String?) async {
        guard !pausedRuns.contains(runID) else { return }
        var transfer = original
        let remote = makeRemote()
        do {
            try await remote.connect(profile: profile, password: password)
            defer { Task { await remote.disconnect() } }
            if transfer.state == .queued {
                transfer.state = .exporting; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
                let asset = try photoLibrary.asset(for: transfer.localIdentifier)
                transfer.manifest = try await exporter.stage(asset: asset, runID: runID, transferID: transfer.id)
                transfer.fingerprint = ContentHasher.assetFingerprint(transfer.manifest)
                transfer.state = .staged; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            }
            guard let fingerprint = transfer.fingerprint else { throw PicSyncError.sourceUnavailable }
            let recordPath = ".picsync/objects/\(fingerprint.prefix(2))/\(fingerprint).json"
            if let record = try await remote.stat(path: recordPath), record.byteCount > 0 {
                transfer.state = .skippedDuplicate
                transfer.updatedAt = Date()
                try await store.save(transfer: transfer)
                try await updateRunningSummary(runID)
                return
            }
            transfer.state = .uploading; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            for index in transfer.manifest.indices {
                var resource = transfer.manifest[index]
                let final = try await availableName(resource.filename, hash: resource.sha256, directory: await runDestination(runID), remote: remote)
                let temporary = join(remoteDirectory(final), ".\(URL(fileURLWithPath: final).lastPathComponent).picsync-\(transfer.id.uuidString).partial")
                resource.finalPath = final; resource.temporaryPath = temporary; transfer.manifest[index] = resource
                try await store.save(transfer: transfer)
                try await remote.upload(file: URL(fileURLWithPath: resource.stagingPath), to: temporary) { _ in }
                guard (try await remote.stat(path: temporary))?.byteCount == resource.byteCount else { throw CocoaError(.fileReadCorruptFile) }
            }
            transfer.state = .committing; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            for resource in transfer.manifest { try await remote.rename(from: resource.temporaryPath!, to: resource.finalPath!) }
            transfer.state = .indexing; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            try await commitContentRecord(for: transfer, runID: runID, remote: remote)
            transfer.state = .completed; transfer.updatedAt = Date(); try await store.save(transfer: transfer)
            try await updateRunningSummary(runID)
        } catch {
            #if DEBUG
            let paths = transfer.manifest.compactMap(\.finalPath).joined(separator: ",")
            print("[PicSync Sync] asset failed transfer=\(transfer.id.uuidString) state=\(transfer.state.rawValue) paths=\(paths) error=\(String(reflecting: error))")
            #endif
            transfer.state = .failed; transfer.attempts += 1; transfer.errorMessage = error.localizedDescription; transfer.updatedAt = Date(); try? await store.save(transfer: transfer)
            try? await updateRunningSummary(runID)
        }
    }

    private func isPaused(_ runID: UUID) -> Bool { pausedRuns.contains(runID) }
    private func runDestination(_ runID: UUID) async -> String { await store.run(runID).map { RemotePath.normalize("\($0.destinationPath)/") } ?? "" }
    private func availableName(_ name: String, hash: String, directory: String, remote: any RemoteFileService) async throws -> String {
        let preferred = join(directory, name)
        if try await remote.stat(path: preferred) == nil { return preferred }
        for attempt in 0...32 {
            let candidate = join(directory, SafeFilename.collisionName(for: name, hash: hash, attempt: attempt))
            if try await remote.stat(path: candidate) == nil { return candidate }
        }
        throw CocoaError(.fileWriteFileExists)
    }
    private func commitContentRecord(for transfer: AssetTransfer, runID: UUID, remote: any RemoteFileService) async throws {
        guard let fingerprint = transfer.fingerprint else { throw PicSyncError.sourceUnavailable }
        let prefix = String(fingerprint.prefix(2))
        try await remote.createDirectory(path: ".picsync/objects/\(prefix)")
        let recordPath = ".picsync/objects/\(prefix)/\(fingerprint).json"
        if try await remote.stat(path: recordPath) != nil { return }
        let record = RemoteContentRecord(schemaVersion: 1, fingerprint: fingerprint, resources: transfer.manifest, runID: runID, transferID: transfer.id, committedAt: Date())
        let localURL = URL(fileURLWithPath: transfer.manifest[0].stagingPath).deletingLastPathComponent().appendingPathComponent("\(fingerprint).json")
        try JSONEncoder().encode(record).write(to: localURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: localURL) }
        let temporaryPath = "\(recordPath).picsync-\(transfer.id.uuidString).partial"
        try await remote.upload(file: localURL, to: temporaryPath) { _ in }
        try await remote.rename(from: temporaryPath, to: recordPath)
    }
    private func join(_ directory: String, _ name: String) -> String { [directory, name].filter { !$0.isEmpty }.joined(separator: "/") }
    private func remoteDirectory(_ path: String) -> String { path.split(separator: "/").dropLast().joined(separator: "/") }
    private func failPending(_ runID: UUID, message: String) async throws { for var transfer in await store.transfers(for: runID) where transfer.state == .queued { transfer.state = .failed; transfer.errorMessage = message; transfer.updatedAt = Date(); try await store.save(transfer: transfer) } }
    private func finish(_ runID: UUID) async throws {
        guard var run = await store.run(runID) else { return }
        let transfers = await store.transfers(for: runID)
        run.completedCount = transfers.filter { $0.state == .completed }.count
        run.skippedCount = transfers.filter { $0.state == .skippedDuplicate }.count
        run.failedCount = transfers.filter { $0.state == .failed }.count
        run.state = run.failedCount == 0 ? .completed : .completedWithErrors
        run.updatedAt = Date(); try await store.save(run: run)
    }
    private func updateRunningSummary(_ runID: UUID) async throws {
        guard var run = await store.run(runID) else { return }
        let transfers = await store.transfers(for: runID)
        run.completedCount = transfers.filter { $0.state == .completed }.count
        run.skippedCount = transfers.filter { $0.state == .skippedDuplicate }.count
        run.failedCount = transfers.filter { $0.state == .failed }.count
        run.updatedAt = Date()
        try await store.save(run: run)
    }
}

@MainActor @Observable final class AppModel {
    private let store: SyncStore
    private let coordinator: SyncCoordinator
    private var browserService: SMBRemoteFileService?
    private var browserPassword: String?
    var profile: ServerProfile?
    var profiles: [ServerProfile] = []
    var runs: [SyncRun] = []
    var errorMessage: String?
    var connectionVerified = false
    var connectionStatus: String?
    var isTestingConnection = false
    var hasSavedPassword = false
    var isResuming = false
    var transferItems: [AssetTransfer] = []
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
        do {
            try await store.load()
            profiles = await store.profiles()
            profile = profiles.first
            runs = await store.runs()
            if let profile { hasSavedPassword = (try CredentialStore.password(profileID: profile.id)) != nil }
        } catch { show(error) }
    }
    func saveProfile(draft: ServerProfileDraft, password: String) async throws {
        let saved = try draft.profile(reusing: profile?.id)
        if !password.isEmpty { try CredentialStore.save(password, profileID: saved.id); hasSavedPassword = true }
        try await store.save(profile: saved)
        profile = saved
        profiles = await store.profiles()
    }
    func resetConnectionVerification() { connectionVerified = false; connectionStatus = nil }
    func testConnection(draft: ServerProfileDraft, password: String) async throws -> [String] {
        isTestingConnection = true
        connectionVerified = false
        connectionStatus = nil
        defer { isTestingConnection = false }
        var candidate = try draft.profile(reusing: profile?.id)
        candidate.share = ""
        let credential = password.isEmpty ? try CredentialStore.password(profileID: candidate.id) : password
        guard let credential, !credential.isEmpty else { throw PicSyncError.passwordRequired }
        let remote = SMBRemoteFileService()
        do {
            try await remote.connect(profile: candidate, password: credential)
            let shares = try await remote.listShares()
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
    func openShare(_ share: String, draft: ServerProfileDraft, password: String) async throws {
        await browserService?.disconnect()
        var candidate = try draft.profile(reusing: profile?.id)
        candidate.share = share
        let storedCredential = try CredentialStore.password(profileID: candidate.id)
        let credential = password.isEmpty ? (browserPassword ?? storedCredential) : password
        guard let credential, !credential.isEmpty else { throw PicSyncError.passwordRequired }
        let remote = SMBRemoteFileService()
        do { try await remote.connect(profile: candidate, password: credential); browserService = remote }
        catch {
            #if DEBUG
            print("[PicSync SMB] failed share=\(share) error=\(String(reflecting: error))")
            #endif
            await remote.disconnect()
            throw SMBShareError(share: share, underlying: error)
        }
    }
    func remoteDirectory(path: String) async throws -> [RemoteItem] {
        guard let browserService else { throw URLError(.notConnectedToInternet) }
        do { return try await browserService.listDirectory(path: path) }
        catch { throw SMBBrowseError(path: path, underlying: error) }
    }
    func createRun(items: [PhotosPickerItem], parallelism: Int) async throws -> SyncRun { guard let profile else { throw PicSyncError.invalidServerAddress }; let identifiers = try PhotoLibraryService().localIdentifiers(for: items); let run = try await coordinator.createRun(itemIdentifiers: identifiers, profile: profile, parallelism: parallelism); runs = await store.runs(); return run }
    func createAlbumRun(_ album: PhotoAlbum, parallelism: Int) async throws -> SyncRun { guard let profile else { throw PicSyncError.invalidServerAddress }; let identifiers = try PhotoLibraryService().assetIdentifiers(forAlbumID: album.id); guard !identifiers.isEmpty else { throw PicSyncError.sourceUnavailable }; let run = try await coordinator.createRun(itemIdentifiers: identifiers, profile: profile, parallelism: parallelism, sourceLabel: album.title); runs = await store.runs(); return run }
    func pause(runID: UUID) async { do { try await coordinator.pause(runID); runs = await store.runs() } catch { show(error) } }
    func retryFailed(runID: UUID) async { do { try await coordinator.retryFailed(runID); runs = await store.runs() } catch { show(error) } }
    func loadTransfers(runID: UUID) async { transferItems = await store.transfers(for: runID) }
    func refreshRun(runID: UUID) async {
        if let run = await store.run(runID) {
            if let index = runs.firstIndex(where: { $0.id == runID }) { runs[index] = run }
            else { runs.insert(run, at: 0) }
        }
    }
    func resume(runID: UUID) async {
        guard !isResuming else { return }
        guard let profile else { show(PicSyncError.invalidServerAddress); return }
        isResuming = true
        defer { isResuming = false }
        #if DEBUG
        print("[PicSync Sync] resume button run=\(runID.uuidString) profile=\(profile.id.uuidString)")
        #endif
        do {
            try await coordinator.run(runID, profile: profile, password: try CredentialStore.password(profileID: profile.id))
            runs = await store.runs()
            transferItems = await store.transfers(for: runID)
        } catch {
            #if DEBUG
            print("[PicSync Sync] resume failed run=\(runID.uuidString) error=\(String(reflecting: error))")
            #endif
            runs = await store.runs()
            transferItems = await store.transfers(for: runID)
            show(error)
        }
    }
    func show(_ error: Error) { errorMessage = error.localizedDescription }
}
