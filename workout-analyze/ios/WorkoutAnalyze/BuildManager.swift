import CryptoKit
import Foundation

final class BoundedHTTPSDownload: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    private let limit: Int
    private var bytes = Data()
    private var continuation: CheckedContinuation<Data, Error>?
    private var session: URLSession?

    private init(limit: Int) { self.limit = limit }

    static func fetch(_ url: URL, limit: Int) async throws -> Data {
        guard url.scheme?.lowercased() == "https" else { throw ShellError.download("HTTPS is required") }
        let loader = BoundedHTTPSDownload(limit: limit)
        return try await withCheckedThrowingContinuation { continuation in
            loader.continuation = continuation
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 120
            let session = URLSession(configuration: configuration, delegate: loader, delegateQueue: nil)
            loader.session = session
            session.dataTask(with: url).resume()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme?.lowercased() == "https" ? request : nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              http.url?.scheme?.lowercased() == "https",
              (http.expectedContentLength < 0 || http.expectedContentLength <= Int64(limit)) else {
            completionHandler(.cancel)
            finish(.failure(ShellError.download("Unexpected response or oversized content")))
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard bytes.count + data.count <= limit else {
            dataTask.cancel()
            finish(.failure(ShellError.download("Download exceeded its declared bound")))
            return
        }
        bytes.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(ShellError.download(error.localizedDescription))) }
        else { finish(.success(bytes)) }
    }

    private func finish(_ result: Result<Data, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(with: result)
        session?.finishTasksAndInvalidate()
        session = nil
    }
}

@MainActor
final class BuildManager: ObservableObject {
    static let bundledSummary = BuildSummary(buildId: "bundled-1", source: "bundled", engineBuildId: "phase1-engine-v1")

    @Published private(set) var active: BuildSummary = bundledSummary
    @Published private(set) var previous: BuildSummary?
    @Published private(set) var pendingActivationBuildId: String?
    @Published private(set) var lastFailure: String?
    @Published private(set) var developmentURL: URL?

    private let defaults = UserDefaults.standard
    private let fileManager = FileManager.default
    private let log: DiagnosticLog
    private let installedRoot: URL

    init(log: DiagnosticLog) {
        self.log = log
        let support = try! fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        installedRoot = support.appendingPathComponent("InstalledBuilds", isDirectory: true)
        try? fileManager.createDirectory(at: installedRoot, withIntermediateDirectories: true)
        restorePointers()
    }

    var sourceDescription: String { developmentURL?.absoluteString ?? "Installed build: \(active.buildId)" }

    func bundledRoot() -> URL {
        Bundle.main.resourceURL!.appendingPathComponent("BundledBuild", isDirectory: true)
    }

    func root(for summary: BuildSummary) -> URL {
        summary.source == "bundled" ? bundledRoot() : installedRoot.appendingPathComponent(summary.buildId, isDirectory: true)
    }

    func activeUIURL() -> URL {
        if let developmentURL { return developmentURL }
        let entry = manifest(for: active)?.uiEntryPath ?? "ui/index.html"
        return URL(string: "workout-analyze://app/\(entry)")!
    }

    func activeEngineURL() -> URL {
        let entry = manifest(for: active)?.engineEntryPath ?? "engine/tiny-engine.js"
        return root(for: active).appendingPathComponent(entry)
    }

    func manifest(for summary: BuildSummary) -> BuildManifest? {
        let url = root(for: summary).appendingPathComponent("manifest.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? ContractValidation.validateManifest(data: data)
    }

    func downloaded() -> [BuildSummary] {
        guard let urls = try? fileManager.contentsOfDirectory(at: installedRoot, includingPropertiesForKeys: nil) else { return [] }
        return urls.compactMap { url in
            guard let data = try? Data(contentsOf: url.appendingPathComponent("manifest.json")),
                  let manifest = try? ContractValidation.validateManifest(data: data) else { return nil }
            return BuildSummary(buildId: manifest.buildId, source: "installed", engineBuildId: manifest.engineBuildId)
        }.sorted { $0.buildId < $1.buildId }
    }

    func statusDictionary() -> [String: Any] {
        [
            "active": active.dictionary,
            "previous": previous?.dictionary ?? NSNull(),
            "bundled": Self.bundledSummary.dictionary,
            "downloaded": downloaded().map(\.dictionary),
            "pendingActivationBuildId": pendingActivationBuildId ?? NSNull(),
            "lastFailure": lastFailure ?? NSNull()
        ]
    }

    func configureDevelopmentSource(_ raw: String?) throws -> [String: Any] {
        if let raw {
            guard let url = ContractValidation.developmentURL(raw) else { throw ShellError.invalidRequest("Development URL must be an HTTP(S) origin without credentials, path, query, or fragment") }
            developmentURL = url
            defaults.set(url.absoluteString, forKey: "developmentURL")
            log.append(subsystem: "source", message: "Development origin selected", metadata: ["origin": url.absoluteString])
            return ["source": ["kind": "development", "url": url.absoluteString], "reloadRequired": true]
        }
        developmentURL = nil
        defaults.removeObject(forKey: "developmentURL")
        try activateSummary(Self.bundledSummary)
        log.append(subsystem: "source", message: "Bundled source selected")
        return ["source": ["kind": "bundled"], "reloadRequired": true]
    }

    func download(manifestURL: URL) async throws -> BuildSummary {
        guard manifestURL.scheme == "https" else { throw ShellError.download("Manifest URL must use HTTPS") }
        do {
            let manifestData = try await BoundedHTTPSDownload.fetch(manifestURL, limit: 1024 * 1024)
            let manifest = try ContractValidation.validateManifest(data: manifestData)
            guard manifest.buildId != Self.bundledSummary.buildId else { throw ShellError.incompatibleBuild("Build ID is reserved") }
            let staging = installedRoot.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
            try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
            defer { try? fileManager.removeItem(at: staging) }
            let base = manifestURL.deletingLastPathComponent()
            for file in manifest.files {
                guard let remote = URL(string: file.path, relativeTo: base)?.absoluteURL,
                      ContractValidation.sameOrigin(remote, manifestURL), remote.scheme == "https" else {
                    throw ShellError.download("Build files must remain on the manifest HTTPS origin")
                }
                let data = try await BoundedHTTPSDownload.fetch(remote, limit: file.sizeBytes)
                guard data.count == file.sizeBytes,
                      SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == file.sha256 else {
                    throw ShellError.download("Size or SHA-256 mismatch for \(file.path)")
                }
                let destination = staging.appendingPathComponent(file.path)
                try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: destination, options: .atomic)
            }
            try manifestData.write(to: staging.appendingPathComponent("manifest.json"), options: .atomic)
            let destination = installedRoot.appendingPathComponent(manifest.buildId, isDirectory: true)
            guard !fileManager.fileExists(atPath: destination.path) else { throw ShellError.download("Build ID is already installed") }
            try fileManager.moveItem(at: staging, to: destination)
            let summary = BuildSummary(buildId: manifest.buildId, source: "installed", engineBuildId: manifest.engineBuildId)
            pendingActivationBuildId = summary.buildId
            lastFailure = nil
            log.append(subsystem: "build", message: "Verified build downloaded", metadata: ["buildId": summary.buildId])
            return summary
        } catch {
            recordFailure(error.localizedDescription)
            throw error
        }
    }

    func activate(buildId: String) throws -> BuildSummary {
        guard let target = downloaded().first(where: { $0.buildId == buildId }) else { throw ShellError.invalidRequest("Unknown installed build") }
        try activateSummary(target)
        return target
    }

    func rollback(target: String) throws -> BuildSummary {
        let selected: BuildSummary
        if target == "bundled" { selected = Self.bundledSummary }
        else if let previous { selected = previous }
        else { throw ShellError.invalidState("No previous build is available") }
        try activateSummary(selected)
        return selected
    }

    func handshakeFailed(reason: String) {
        guard developmentURL == nil else { recordFailure("Development UI handshake failed: \(reason)"); return }
        guard active.source == "installed" else { recordFailure("Bundled UI handshake failed: \(reason)"); return }
        let failed = active
        active = previous ?? Self.bundledSummary
        previous = failed
        persistPointers()
        recordFailure("Build \(failed.buildId) handshake failed; restored \(active.buildId): \(reason)")
    }

    private func activateSummary(_ target: BuildSummary) throws {
        guard manifest(for: target) != nil else { throw ShellError.incompatibleBuild("Build files are missing or invalid") }
        if target != active { previous = active; active = target }
        developmentURL = nil
        defaults.removeObject(forKey: "developmentURL")
        pendingActivationBuildId = nil
        lastFailure = nil
        persistPointers()
        log.append(subsystem: "build", message: "Build pointer activated", metadata: ["buildId": target.buildId])
    }

    private func recordFailure(_ message: String) {
        lastFailure = String(message.prefix(2048))
        defaults.set(lastFailure, forKey: "buildLastFailure")
        log.append(subsystem: "build", message: "Build operation failed", metadata: ["reason": lastFailure ?? "unknown"])
    }

    private func restorePointers() {
        lastFailure = defaults.string(forKey: "buildLastFailure")
        if let raw = defaults.string(forKey: "developmentURL") { developmentURL = ContractValidation.developmentURL(raw) }
        if let data = defaults.data(forKey: "activeBuild"), let summary = try? JSONDecoder().decode(BuildSummary.self, from: data), manifest(for: summary) != nil { active = summary }
        if let data = defaults.data(forKey: "previousBuild"), let summary = try? JSONDecoder().decode(BuildSummary.self, from: data), manifest(for: summary) != nil { previous = summary }
    }

    private func persistPointers() {
        defaults.set(try? JSONEncoder().encode(active), forKey: "activeBuild")
        defaults.set(try? previous.map { try JSONEncoder().encode($0) }, forKey: "previousBuild")
    }
}
