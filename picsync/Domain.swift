import Foundation
import SwiftUI

struct ServerProfile: Codable, Identifiable, Equatable, Sendable {
    var id: UUID
    var displayName: String
    var host: String
    var port: Int
    var username: String
    var domain: String?
    var share: String
    var destinationPath: String
    var requiresSigning: Bool
    var createdAt: Date
    var updatedAt: Date
}

struct ServerProfileDraft: Equatable {
    var host = ""
    var port = 445
    var username = ""
    var domain = ""
    var share = ""
    var destinationPath = ""
    var requiresSigning = false

    init(_ profile: ServerProfile? = nil) {
        guard let profile else { return }
        host = profile.host
        port = profile.port
        username = profile.username
        domain = profile.domain ?? ""
        share = profile.share
        destinationPath = profile.destinationPath
        requiresSigning = profile.requiresSigning
    }

    var isValid: Bool { !host.trimmingCharacters(in: .whitespaces).isEmpty && !username.isEmpty && port > 0 && port < 65_536 }

    func profile(reusing id: UUID? = nil) throws -> ServerProfile {
        let endpoint = try SMBEndpoint.parse(host, defaultPort: port)
        let now = Date()
        return ServerProfile(id: id ?? UUID(), displayName: endpoint.host, host: endpoint.host, port: endpoint.port, username: username, domain: domain.nilIfEmpty, share: share.nilIfEmpty ?? endpoint.share ?? "", destinationPath: RemotePath.normalize(destinationPath.isEmpty ? endpoint.path : destinationPath), requiresSigning: requiresSigning, createdAt: now, updatedAt: now)
    }
}

struct SMBEndpoint: Equatable, Sendable {
    let host: String
    let port: Int
    let share: String?
    let path: String

    static func parse(_ value: String, defaultPort: Int = 445) throws -> Self {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw PicSyncError.invalidServerAddress }
        let source = trimmed.contains("://") ? trimmed : "smb://\(trimmed)"
        guard let components = URLComponents(string: source), components.scheme?.lowercased() == "smb", components.user == nil, components.password == nil, let host = components.host, !host.isEmpty else { throw PicSyncError.invalidServerAddress }
        let port = components.port ?? defaultPort
        guard (1...65_535).contains(port) else { throw PicSyncError.invalidServerAddress }
        let pieces = components.path.split(separator: "/").map(String.init)
        return Self(host: host, port: port, share: pieces.first, path: pieces.dropFirst().joined(separator: "/"))
    }
}

enum RemotePath {
    static func normalize(_ path: String) -> String {
        path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).filter { $0 != "." && $0 != ".." }.joined(separator: "/")
    }
}

enum SafeFilename {
    static func make(_ candidate: String, fallback: String) -> String {
        let leaf = candidate.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
        let filtered = leaf.unicodeScalars.filter { $0.properties.generalCategory != .control && $0 != ":" && $0 != "*" && $0 != "?" && $0 != "\"" && $0 != "<" && $0 != ">" && $0 != "|" }
        let name = String(String.UnicodeScalarView(filtered)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != ".." else { return fallback }
        return name.precomposedStringWithCanonicalMapping
    }

    static func collisionName(for name: String, hash: String, attempt: Int = 0) -> String {
        let url = URL(fileURLWithPath: name)
        let suffix = String(hash.prefix(attempt == 0 ? 8 : min(hash.count, 8 + attempt * 4)))
        let counter = attempt > 8 ? "_\(attempt - 8)" : ""
        return "\(url.deletingPathExtension().lastPathComponent)_\(suffix)\(counter)\(url.pathExtension.isEmpty ? "" : ".\(url.pathExtension)")"
    }
}

enum PicSyncError: LocalizedError, Equatable {
    case invalidServerAddress
    case passwordInURL
    case photosPermission
    case passwordRequired
    case invalidFolderName
    case sourceUnavailable
    case unsupportedSMB
    case cancelled
    case runActive

    var errorDescription: String? {
        switch self {
        case .invalidServerAddress: "Enter an SMB server address such as smb://raspberrypi/share/photos."
        case .passwordInURL: "For security, enter the password only in the Password field."
        case .photosPermission: "PicSync needs Photos access to export originals."
        case .passwordRequired: "Enter the SMB password before testing this server. PicSync will not silently fall back to guest access."
        case .invalidFolderName: "Enter a folder name without slashes."
        case .sourceUnavailable: "One or more selected photos are no longer available."
        case .unsupportedSMB: "The SMB transport has not been installed in this build."
        case .cancelled: "The sync was cancelled."
        case .runActive: "Pause this sync and wait for its active workers to finish before deleting it."
        }
    }
}

enum SyncRunState: String, Codable, Sendable {
    case preparing, running, pausing, paused, completed, completedWithErrors, cancelled
    var displayName: String { rawValue.replacingOccurrences(of: "With", with: " with ").capitalized }
    var isResumable: Bool { self == .paused || self == .preparing || self == .completedWithErrors }
    var tint: Color { self == .completed ? .green : self == .completedWithErrors ? .orange : self == .cancelled ? .red : .blue }
}

enum AssetTransferState: String, Codable, Sendable { case queued, exporting, staged, deduplicating, uploading, committing, indexing, completed, skippedDuplicate, failed, cancelled }

extension AssetTransferState {
    var isTerminal: Bool { self == .completed || self == .skippedDuplicate || self == .failed || self == .cancelled }
}

struct ResourceManifest: Codable, Sendable, Equatable {
    var role: String
    var filename: String
    var stagingPath: String
    var byteCount: Int64
    var sha256: String
    var finalPath: String?
    var temporaryPath: String?
}

struct AssetTransfer: Codable, Identifiable, Sendable, Equatable {
    var id: UUID
    var runID: UUID
    var localIdentifier: String
    var state: AssetTransferState
    var manifest: [ResourceManifest]
    var fingerprint: String?
    var attempts: Int
    var errorMessage: String?
    var updatedAt: Date
}

struct SyncRun: Codable, Identifiable, Sendable, Equatable, Hashable {
    var id: UUID
    var sourceLabel: String
    var assetIdentifiers: [String]
    var profileID: UUID
    var share: String
    var destinationPath: String
    var parallelism: Int
    var activeWorkerCount: Int?
    var state: SyncRunState
    var createdAt: Date
    var updatedAt: Date
    var completedBytes: Int64
    var totalBytes: Int64
    var completedCount: Int
    var skippedCount: Int
    var failedCount: Int
}

private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }
