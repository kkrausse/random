import Foundation
import Photos
import Testing
@testable import picsync

struct picsyncTests {
    @Test func parsesStructuredSMBURLWithoutCredentials() throws {
        let endpoint = try SMBEndpoint.parse("smb://nas.local:1445/media/Photos/2026")
        #expect(endpoint.host == "nas.local")
        #expect(endpoint.port == 1445)
        #expect(endpoint.share == "media")
        #expect(endpoint.path == "Photos/2026")
        #expect(throws: PicSyncError.invalidServerAddress) { try SMBEndpoint.parse("smb://user:secret@nas.local/media") }
    }

    @Test func sanitizesNamesAndMakesStableCollisionNames() {
        #expect(SafeFilename.make("../../IMG:01?.jpg", fallback: "fallback.jpg") == "IMG01.jpg")
        #expect(SafeFilename.make("..", fallback: "fallback.jpg") == "fallback.jpg")
        #expect(SafeFilename.collisionName(for: "IMG_0001.HEIC", hash: "0123456789abcdef") == "IMG_0001_01234567.HEIC")
        #expect(RemotePath.normalize("/Photos/../2026//Trip") == "Photos/2026/Trip")
    }

    @Test func selectsOnlyOriginalPhotoResources() {
        #expect(PhotoResourceSelector.includes(type: .photo))
        #expect(PhotoResourceSelector.includes(type: .video))
        #expect(PhotoResourceSelector.includes(type: .pairedVideo))
        #expect(PhotoResourceSelector.includes(type: .alternatePhoto))
        #expect(!PhotoResourceSelector.includes(type: .fullSizePhoto))
        #expect(!PhotoResourceSelector.includes(type: .adjustmentData))
    }

    @Test func rejectsSharedAlbumCopiesAsOriginals() {
        #expect(PhotoLibraryService.originalResourcesAvailable(for: .typeUserLibrary))
        #expect(!PhotoLibraryService.originalResourcesAvailable(for: .typeCloudShared))
    }

    @Test func hashesFilesInChunks() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data(repeating: 0x61, count: 2_500_000).write(to: url)
        #expect(try ContentHasher.hash(file: url, chunkSize: 1024) == "38a637965059125eeb67f54c30e7f48a61859a467a800ba09740ba48a924f2b9")
    }

    @Test func workersClaimEachTransferFromSQLiteExactlyOnce() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SyncStore(url: directory.appendingPathComponent("journal.sqlite"))
        try await store.load()
        let runID = UUID()
        let transfers = (0..<50).map {
            AssetTransfer(id: UUID(), runID: runID, localIdentifier: "\($0)", state: .queued, manifest: [], fingerprint: nil, attempts: 0, errorMessage: nil, updatedAt: Date())
        }
        let now = Date()
        let run = SyncRun(id: runID, sourceLabel: "Test", assetIdentifiers: transfers.map(\.localIdentifier), profileID: UUID(), share: "Photos", destinationPath: "", parallelism: 7, activeWorkerCount: 0, state: .preparing, createdAt: now, updatedAt: now, completedBytes: 0, totalBytes: 0, completedCount: 0, skippedCount: 0, failedCount: 0)
        try await store.save(run: run, transfers: transfers)
        let identifiers = try await withThrowingTaskGroup(of: [String].self, returning: [String].self) { group in
            for _ in 0..<7 {
                group.addTask {
                    var values = [String]()
                    while let transfer = try await store.claimNext(runID) { values.append(transfer.localIdentifier) }
                    return values
                }
            }
            return try await group.reduce(into: []) { $0.append(contentsOf: $1) }
        }

        #expect(identifiers.count == transfers.count)
        #expect(Set(identifiers).count == transfers.count)
        #expect(Set(identifiers) == Set(transfers.map(\.localIdentifier)))
    }

    @Test func connectionTestTimesOut() async {
        await #expect(throws: ConnectionTestError.self) {
            try await withConnectionTestTimeout(after: .milliseconds(10)) {
                try await Task.sleep(for: .seconds(1))
                return true
            }
        }
    }

    @Test func loadsExistingJournalAndPersistsSelectedDestination() async throws {
        struct LegacySnapshot: Codable {
            var profiles: [ServerProfile]
            var runs: [SyncRun] = []
            var transfers: [AssetTransfer] = []
        }

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("journal.sqlite")
        let legacy = directory.appendingPathComponent("journal.json")
        let first = profile(host: "100.64.0.1", updatedAt: Date(timeIntervalSince1970: 1))
        let second = profile(host: "192.168.1.207", updatedAt: Date(timeIntervalSince1970: 2))
        try JSONEncoder().encode(LegacySnapshot(profiles: [first, second])).write(to: legacy)

        let store = SyncStore(url: url)
        try await store.load()
        #expect(try await store.profiles().map(\.id) == [second.id, first.id])
        #expect(try await store.activeProfileID() == nil)

        try await store.selectProfile(first.id)
        let reloaded = SyncStore(url: url)
        try await reloaded.load()
        #expect(try await reloaded.activeProfileID() == first.id)
        #expect(try await reloaded.profiles().count == 2)
    }

    private func profile(host: String, updatedAt: Date) -> ServerProfile {
        ServerProfile(id: UUID(), displayName: host, host: host, port: 445, username: "iphone", domain: nil, share: "Photos", requiresSigning: false, createdAt: updatedAt, updatedAt: updatedAt)
    }
}
