import Foundation
import SMBClient

struct RemoteItem: Sendable, Equatable, Identifiable {
    var id: String { path }
    var name: String
    var path: String
    var byteCount: Int64
    var isDirectory: Bool
}

protocol RemoteFileService: Sendable {
    func connect(profile: ServerProfile, password: String?) async throws
    func disconnect() async
    func listShares() async throws -> [String]
    func listDirectory(path: String) async throws -> [RemoteItem]
    func createDirectory(path: String) async throws
    func stat(path: String) async throws -> RemoteItem?
    func upload(file: URL, to path: String, progress: @escaping @Sendable (Int64) async -> Void) async throws
    func rename(from: String, to: String) async throws
    func delete(path: String) async throws
}

actor SMBRemoteFileService: RemoteFileService {
    private var client: SMBClient?

    func connect(profile: ServerProfile, password: String?) async throws {
        let client = SMBClient(host: profile.host, port: profile.port)
        #if DEBUG
        print("[PicSync SMB] authenticating host=\(profile.host) port=\(profile.port)")
        #endif
        try await client.login(username: profile.username, password: password, domain: profile.domain)
        if !profile.share.isEmpty {
            #if DEBUG
            print("[PicSync SMB] opening share=\(profile.share)")
            #endif
            try await client.connectShare(profile.share)
            #if DEBUG
            print("[PicSync SMB] opened share=\(profile.share)")
            #endif
        }
        self.client = client
    }

    func disconnect() async {
        guard let client else { return }
        _ = try? await client.disconnectShare()
        _ = try? await client.logoff()
        self.client = nil
    }

    func listShares() async throws -> [String] {
        try await connectedClient().listShares()
            .map(\.name)
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
    func listDirectory(path: String) async throws -> [RemoteItem] {
        try await connectedClient().listDirectory(path: path).filter { $0.name != "." && $0.name != ".." }.map { RemoteItem(name: $0.name, path: join(path, $0.name), byteCount: Int64($0.size), isDirectory: $0.isDirectory) }
    }

    func createDirectory(path: String) async throws {
        var current = ""
        let client = try connectedClient()
        for component in RemotePath.normalize(path).split(separator: "/") {
            current = join(current, String(component))
            let exists = try await client.existDirectory(path: current)
            if !exists { try await client.createDirectory(path: current) }
        }
    }

    func stat(path: String) async throws -> RemoteItem? {
        let client = try connectedClient()
        do {
            let isFile = try await client.existFile(path: path)
            let isDirectory = try await client.existDirectory(path: path)
            guard isFile || isDirectory else { return nil }
            let file = try await client.fileStat(path: path)
            return RemoteItem(name: URL(fileURLWithPath: path).lastPathComponent, path: path, byteCount: Int64(file.size), isDirectory: file.isDirectory)
        } catch let error as ErrorResponse where Self.isMissingPath(error) {
            // A first-run content-index lookup has no .picsync parent directory yet.
            return nil
        }
    }

    func upload(file: URL, to path: String, progress: @escaping @Sendable (Int64) async -> Void) async throws {
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize.map(Int64.init) ?? 0
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        try await connectedClient().upload(fileHandle: handle, path: path) { fraction in
            Task { await progress(Int64(Double(size) * fraction)) }
        }
    }

    func rename(from: String, to: String) async throws { try await connectedClient().rename(from: from, to: to) }
    func delete(path: String) async throws {
        let client = try connectedClient()
        if let item = try await stat(path: path) { if item.isDirectory { try await client.deleteDirectory(path: path) } else { try await client.deleteFile(path: path) } }
    }

    private func connectedClient() throws -> SMBClient { guard let client else { throw URLError(.notConnectedToInternet) }; return client }
    private func join(_ directory: String, _ name: String) -> String { [directory, name].filter { !$0.isEmpty }.joined(separator: "/") }
    private static func isMissingPath(_ error: ErrorResponse) -> Bool {
        error.header.status == 0xC0000034 || error.header.status == 0xC000003A
    }
}

struct RemoteContentRecord: Codable, Sendable {
    let schemaVersion: Int
    let fingerprint: String
    let resources: [ResourceManifest]
    let runID: UUID
    let transferID: UUID
    let committedAt: Date
}

struct SMBBrowseError: LocalizedError {
    let path: String
    let underlying: Error
    var errorDescription: String? {
        let location = path.isEmpty ? "the root of the selected share" : "folder /\(path)"
        return "Could not open \(location). The server said: \(underlying.localizedDescription). Check that the share and folder still exist and that this user has permission to read them."
    }
}

struct SMBShareError: LocalizedError {
    let share: String
    let underlying: Error
    var errorDescription: String? {
        "Could not open SMB share \(share). The server said: \(underlying.localizedDescription). Debug detail: \(String(reflecting: underlying))"
    }
}
