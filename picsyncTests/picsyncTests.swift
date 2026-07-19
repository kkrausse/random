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

    @Test func hashesFilesInChunks() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data(repeating: 0x61, count: 2_500_000).write(to: url)
        #expect(try ContentHasher.hash(file: url, chunkSize: 1024) == "38a637965059125eeb67f54c30e7f48a61859a467a800ba09740ba48a924f2b9")
    }

    @Test func workersPullEachTransferFromQueueExactlyOnce() async {
        let runID = UUID()
        let transfers = (0..<50).map {
            AssetTransfer(id: UUID(), runID: runID, localIdentifier: "\($0)", state: .queued, manifest: [], fingerprint: nil, attempts: 0, errorMessage: nil, updatedAt: Date())
        }
        let queue = TransferWorkQueue(transfers)
        let identifiers = await withTaskGroup(of: [String].self, returning: [String].self) { group in
            for _ in 0..<7 {
                group.addTask {
                    var values = [String]()
                    while let transfer = await queue.next() { values.append(transfer.localIdentifier) }
                    return values
                }
            }
            return await group.reduce(into: []) { $0.append(contentsOf: $1) }
        }

        #expect(identifiers.count == transfers.count)
        #expect(Set(identifiers).count == transfers.count)
        #expect(Set(identifiers) == Set(transfers.map(\.localIdentifier)))
    }
}
