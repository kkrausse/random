import SwiftUI
import WebKit

@MainActor
final class WebHost: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    private let builds: BuildManager
    private let dispatcher: BridgeDispatcher
    private var handshakeTask: Task<Void, Never>?
    private var receivedHello = false
    private var eventDeliveryTask: Task<Void, Never>?

    init(builds: BuildManager, dispatcher: BridgeDispatcher) {
        self.builds = builds; self.dispatcher = dispatcher
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(LocalSchemeHandler(builds: builds), forURLScheme: "workout-analyze")
        let controller = WKUserContentController()
        configuration.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        controller.add(self, name: "workoutAnalyze")
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        dispatcher.reloadUI = { [weak self] in self?.loadSelectedSource() }
        dispatcher.emitEvent = { [weak self] type, payload in self?.sendEvent(type: type, payload: payload) }
    }

    func loadSelectedSource() {
        receivedHello = false
        handshakeTask?.cancel()
        let url = builds.activeUIURL()
        dispatcher.log.append(subsystem: "source", message: "Loading selected UI source", metadata: ["url": url.absoluteString])
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
        handshakeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled, let self, !self.receivedHello else { return }
            let wasInstalled = self.builds.developmentURL == nil && self.builds.active.source == "installed"
            self.builds.handshakeFailed(reason: "bridge.hello was not received within 8 seconds")
            if wasInstalled { self.loadSelectedSource() }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "workoutAnalyze", message.frameInfo.isMainFrame, isSelectedOrigin(message.frameInfo.securityOrigin) else { return }
        Task {
            let reply = await dispatcher.dispatch(message.body)
            if let object = message.body as? [String: Any], object["method"] as? String == "bridge.hello", reply["ok"] as? Bool == true {
                receivedHello = true; handshakeTask?.cancel()
                dispatcher.log.append(subsystem: "bridge", message: "Development UI bridge handshake completed", metadata: ["source": builds.sourceDescription])
            }
            await sendReply(reply)
        }
    }

    private func isSelectedOrigin(_ origin: WKSecurityOrigin) -> Bool {
        if let development = builds.developmentURL {
            let portMatches = development.port.map { origin.port == $0 }
                ?? (origin.port == 0 || origin.port == (development.scheme == "https" ? 443 : 80))
            return origin.protocol.lowercased() == development.scheme?.lowercased()
                && origin.host.lowercased() == development.host?.lowercased() && portMatches
        }
        return origin.protocol == "workout-analyze" && origin.host == "app"
    }

    private func sendReply(_ reply: [String: Any]) async {
        guard (try? JSONSerialization.data(withJSONObject: reply).count) ?? Int.max <= maximumBridgeBytes else { return }
        do { _ = try await webView.callAsyncJavaScript("window.WorkoutAnalyzeNative.receiveReply(reply)", arguments: ["reply": reply], in: nil, contentWorld: .page) }
        catch { dispatcher.log.append(subsystem: "bridge", message: "Reply delivery failed", metadata: ["reason": error.localizedDescription]) }
    }

    private func sendEvent(type: String, payload: [String: Any]) {
        let sequence = dispatcher.diagnostics.advanceEventSequence()
        var authoritativePayload = payload
        if type == "diagnostics.updated" { authoritativePayload = dispatcher.diagnostics.snapshot() }
        if type == "session.updated" { authoritativePayload = dispatcher.diagnostics.sessionSnapshot() }
        if type == "permissions.updated" { authoritativePayload = dispatcher.diagnostics.permissionStatus() }
        let event: [String: Any] = ["protocolVersion": 1, "sessionId": NSNull(), "sequence": sequence, "type": type, "payload": authoritativePayload]
        let prior = eventDeliveryTask
        eventDeliveryTask = Task { [weak self] in
            _ = await prior?.value
            guard let self else { return }
            guard (try? JSONSerialization.data(withJSONObject: event).count) ?? Int.max <= maximumBridgeBytes else { return }
            do { _ = try await self.webView.callAsyncJavaScript("window.WorkoutAnalyzeNative.receiveEvent(event)", arguments: ["event": event], in: nil, contentWorld: .page) }
            catch { self.dispatcher.log.append(subsystem: "bridge", message: "Event delivery failed", metadata: ["reason": error.localizedDescription]) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard navigationAction.targetFrame?.isMainFrame != false, let url = navigationAction.request.url else { return .allow }
        let allowed: Bool
        if let development = builds.developmentURL { allowed = ContractValidation.sameOrigin(url, development) }
        else { allowed = url.scheme == "workout-analyze" && url.host == "app" }
        if allowed { return .allow }
        if ["http", "https"].contains(url.scheme?.lowercased() ?? "") { await UIApplication.shared.open(url) }
        return .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        dispatcher.log.append(subsystem: "source", message: "Selected UI source finished navigation", metadata: ["url": webView.url?.absoluteString ?? "unknown"])
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        dispatcher.log.append(subsystem: "source", message: "Selected UI source navigation failed", metadata: ["reason": error.localizedDescription, "domain": nsError.domain, "code": String(nsError.code)])
    }
}

struct HostedWebView: UIViewRepresentable {
    let host: WebHost
    func makeUIView(context: Context) -> WKWebView { host.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
