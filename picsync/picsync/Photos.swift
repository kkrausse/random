import CryptoKit
import Foundation
import Photos
import SwiftUI

struct PhotoResourceDescriptor: Equatable, Sendable {
    let role: String
    let filename: String
    let uniformTypeIdentifier: String
}

struct PhotoAlbum: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let count: Int
    let isSmartAlbum: Bool
    let isCloudShared: Bool
}

enum PhotoResourceSelector {
    static func includes(type: PHAssetResourceType) -> Bool {
        switch type {
        case .photo, .video, .audio, .pairedVideo, .alternatePhoto: true
        default: false
        }
    }

    static func descriptors(for resources: [PHAssetResource]) -> [PhotoResourceDescriptor] {
        resources.filter { includes(type: $0.type) }.map {
            PhotoResourceDescriptor(role: role(for: $0.type), filename: $0.originalFilename, uniformTypeIdentifier: $0.uniformTypeIdentifier)
        }
    }

    static func role(for type: PHAssetResourceType) -> String {
        switch type {
        case .photo: "photo"
        case .video: "video"
        case .audio: "audio"
        case .pairedVideo: "pairedVideo"
        case .alternatePhoto: "alternatePhoto"
        default: "excluded"
        }
    }
}

struct PhotoLibraryService {
    static func originalResourcesAvailable(for sourceType: PHAssetSourceType) -> Bool {
        !sourceType.contains(.typeCloudShared)
    }

    func requestAuthorization() async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else { throw PicSyncError.photosPermission }
    }

    func asset(for localIdentifier: String) throws -> PHAsset {
        let result = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
        guard let asset = result.firstObject else {
            AppLog.write("[Photos] asset identifier no longer resolves identifier=\(localIdentifier)")
            throw PicSyncError.photoAssetUnavailable
        }
        guard Self.originalResourcesAvailable(for: asset.sourceType) else { throw PicSyncError.sharedAlbumOriginalUnavailable }
        return asset
    }

    func validateOriginalAvailability(for localIdentifiers: [String]) throws {
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
        var containsCloudSharedAsset = false
        assets.enumerateObjects { asset, _, stop in
            if !Self.originalResourcesAvailable(for: asset.sourceType) {
                containsCloudSharedAsset = true
                stop.pointee = true
            }
        }
        guard !containsCloudSharedAsset else { throw PicSyncError.sharedAlbumOriginalUnavailable }
    }

    func albums() throws -> [PhotoAlbum] {
        let user = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
        let smart = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .any, options: nil)
        return collections(from: user, isSmartAlbum: false) + collections(from: smart, isSmartAlbum: true)
    }

    func assetIdentifiers(forAlbumID id: String) throws -> [String] {
        let collections = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [id], options: nil)
        guard let collection = collections.firstObject else { throw PicSyncError.sourceUnavailable }
        let assets = PHAsset.fetchAssets(in: collection, options: nil)
        var identifiers = [String]()
        assets.enumerateObjects { asset, _, _ in identifiers.append(asset.localIdentifier) }
        return identifiers
    }

    private func collections(from result: PHFetchResult<PHAssetCollection>, isSmartAlbum: Bool) -> [PhotoAlbum] {
        var albums = [PhotoAlbum]()
        result.enumerateObjects { collection, _, _ in
            let count = PHAsset.fetchAssets(in: collection, options: nil).count
            if count > 0 {
                albums.append(PhotoAlbum(
                    id: collection.localIdentifier,
                    title: collection.localizedTitle ?? "Untitled Album",
                    count: count,
                    isSmartAlbum: isSmartAlbum,
                    isCloudShared: collection.assetCollectionSubtype == .albumCloudShared
                ))
            }
        }
        return albums.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}

struct PhotoResourceExporter {
    private let manager = PHAssetResourceManager.default()

    func stage(asset: PHAsset, runID: UUID, transferID: UUID, budget: StagingBudget, runtime: TransferRuntime) async throws -> [ResourceManifest] {
        let resources = PHAssetResource.assetResources(for: asset).filter { PhotoResourceSelector.includes(type: $0.type) }
        guard !resources.isEmpty else { throw PicSyncError.sourceUnavailable }
        let directory = budget.root.appendingPathComponent(runID.uuidString).appendingPathComponent(transferID.uuidString)
        // A crash during export may leave files which never made it into a manifest.
        try budget.remove(directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var manifests = [ResourceManifest]()
        do {
            for (index, resource) in resources.enumerated() {
                try runtime.check()
                let role = PhotoResourceSelector.role(for: resource.type)
                let ext = URL(fileURLWithPath: resource.originalFilename).pathExtension
                let fallback = "\(asset.creationDate.map { Self.fallbackDate.string(from: $0) } ?? "asset")_\(String(asset.localIdentifier.prefix(8)))_\(role)\(ext.isEmpty ? "" : ".\(ext)")"
                let filename = SafeFilename.make(resource.originalFilename, fallback: fallback)
                let localURL = directory.appendingPathComponent("\(index)-\(UUID().uuidString).\(URL(fileURLWithPath: filename).pathExtension)")
                let temporaryURL = localURL.appendingPathExtension("partial")
                runtime.update(transferID, filename: filename, phase: "Exporting original")
                try await export(resource, to: temporaryURL, budget: budget, runtime: runtime)
                try FileManager.default.moveItem(at: temporaryURL, to: localURL)
                runtime.update(transferID, filename: filename, phase: "Hashing original")
                let hash = try await ContentHasher.hashAsync(file: localURL, check: { try runtime.check() })
                let size = try localURL.resourceValues(forKeys: [.fileSizeKey]).fileSize.map(Int64.init) ?? 0
                manifests.append(ResourceManifest(role: role, filename: filename, stagingPath: localURL.path, byteCount: size, sha256: hash, finalPath: nil, temporaryPath: nil))
            }
        } catch {
            try? budget.remove(directory)
            throw error
        }
        return manifests
    }

    private func export(_ resource: PHAssetResource, to url: URL, budget: StagingBudget, runtime: TransferRuntime) async throws {
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        let writer = try PhotoExportWriter(url: url, budget: budget, runtime: runtime, manager: manager)
        let pauseHandler = runtime.onPause { writer.cancel() }
        defer { runtime.removePauseHandler(pauseHandler) }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let id = manager.requestData(for: resource, options: options, dataReceivedHandler: { writer.receive($0) }) { error in
                    do { try writer.finish(error); continuation.resume() }
                    catch { continuation.resume(throwing: error) }
                }
                writer.setRequest(id)
            }
        } onCancel: {
            writer.cancel()
        }
    }

    private static let fallbackDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        return formatter
    }()
}

private final class PhotoExportWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let handle: FileHandle
    private let budget: StagingBudget
    private let runtime: TransferRuntime
    private let manager: PHAssetResourceManager
    private var request: PHAssetResourceDataRequestID?
    private var failure: Error?

    init(url: URL, budget: StagingBudget, runtime: TransferRuntime, manager: PHAssetResourceManager) throws {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        handle = try FileHandle(forWritingTo: url)
        self.budget = budget; self.runtime = runtime; self.manager = manager
    }
    func setRequest(_ id: PHAssetResourceDataRequestID) {
        let cancel = lock.withLock { request = id; return failure != nil }
        if cancel { manager.cancelDataRequest(id) }
    }
    func cancel() {
        let id = lock.withLock { failure = failure ?? TransferError.paused; return request }
        if let id { manager.cancelDataRequest(id) }
    }
    func receive(_ data: Data) {
        let cancelID: PHAssetResourceDataRequestID? = lock.withLock {
            guard failure == nil else { return request }
            do {
                try runtime.check()
                let before = try handle.offset()
                try budget.reserve(Int64(data.count), runtime: runtime)
                do { try handle.write(contentsOf: data) }
                catch {
                    // Account for partial local writes as well as successfully written chunks.
                    let written = (try? handle.offset()).map { Int64($0 - before) } ?? Int64(data.count)
                    budget.release(max(0, Int64(data.count) - written))
                    throw error
                }
                return nil
            } catch {
                failure = error
                return request
            }
        }
        if let cancelID { manager.cancelDataRequest(cancelID) }
    }
    func finish(_ error: Error?) throws {
        try lock.withLock {
            try handle.close()
            if let error = failure ?? error { throw error }
        }
    }
}

enum ContentHasher {
    static func hashAsync(file url: URL, prefixBytes: Int64? = nil, check: @escaping @Sendable () throws -> Void = {}) async throws -> String {
        try await Task.detached(priority: .utility) {
            try hash(file: url, prefixBytes: prefixBytes, check: check)
        }.value
    }
    static func hash(file url: URL, chunkSize: Int = 1_048_576, prefixBytes: Int64? = nil, check: () throws -> Void = {}) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        var remaining = prefixBytes ?? Int64.max
        while true {
            try check()
            guard remaining > 0 else { break }
            let data = try handle.read(upToCount: Int(min(Int64(chunkSize), remaining))) ?? Data()
            guard !data.isEmpty else {
                if prefixBytes != nil { throw CocoaError(.fileReadCorruptFile) }
                break
            }
            hasher.update(data: data)
            remaining -= Int64(data.count)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func assetFingerprint(_ resources: [ResourceManifest]) -> String {
        let canonical = resources.sorted { $0.role == $1.role ? $0.sha256 < $1.sha256 : $0.role < $1.role }
            .map { "\($0.role)|\($0.byteCount)|\($0.sha256)" }.joined(separator: "\n")
        return SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
