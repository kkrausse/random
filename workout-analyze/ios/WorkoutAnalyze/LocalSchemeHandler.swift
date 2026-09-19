import Foundation
import UniformTypeIdentifiers
import WebKit

@MainActor
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    private let builds: BuildManager
    init(builds: BuildManager) { self.builds = builds }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.scheme == "workout-analyze", url.host == "app",
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            urlSchemeTask.didFailWithError(ShellError.invalidRequest("Invalid local URL")); return
        }
        let relative = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard ContractValidation.safeRelativePath(relative) else {
            urlSchemeTask.didFailWithError(ShellError.invalidRequest("Unsafe local path")); return
        }
        let root = builds.root(for: builds.active).standardizedFileURL
        let file = root.appendingPathComponent(relative).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let moduleMIME = ["js", "mjs"].contains(file.pathExtension.lowercased()) ? "text/javascript" : mime
        let response = URLResponse(url: url, mimeType: moduleMIME, expectedContentLength: data.count, textEncodingName: ["html", "css", "js", "json", "svg"].contains(file.pathExtension.lowercased()) ? "utf-8" : nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}
}
