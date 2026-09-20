import SwiftUI
import UIKit

@main
struct WorkoutAnalyzeApp: App {
    @StateObject private var model = AppHostModel()

    var body: some Scene {
        WindowGroup { RootView(model: model) }
    }
}

@MainActor
final class AppHostModel: ObservableObject {
    let log: DiagnosticLog
    let builds: BuildManager
    let sensors: SensorService
    let diagnostics: DiagnosticsService
    let dispatcher: BridgeDispatcher
    let web: WebHost

    init() {
        let log = DiagnosticLog()
        let builds = BuildManager(log: log)
        let sensors = SensorService(log: log)
        let diagnostics = DiagnosticsService(log: log, builds: builds, sensors: sensors)
        let dispatcher = BridgeDispatcher(builds: builds, diagnostics: diagnostics, sensors: sensors, log: log)
        self.log = log; self.builds = builds; self.sensors = sensors; self.diagnostics = diagnostics; self.dispatcher = dispatcher
        web = WebHost(builds: builds, dispatcher: dispatcher)
        sensors.emitEvent = { [weak dispatcher] type, payload in dispatcher?.emitEvent?(type, payload) }
        dispatcher.presentShare = { url in
            guard let controller = UIApplication.shared.topViewController else { return false }
            controller.present(UIActivityViewController(activityItems: [url], applicationActivities: nil), animated: true)
            return true
        }
        log.append(subsystem: "lifecycle", message: "Native host launched")
    }
}

struct RootView: View {
    @ObservedObject var model: AppHostModel
    @State private var recoveryPresented = false

    var body: some View {
        HostedWebView(host: model.web)
            .ignoresSafeArea(.container, edges: .bottom)
            .overlay(alignment: .topTrailing) {
                Button { recoveryPresented = true } label: {
                    Image(systemName: "wrench.and.screwdriver").padding(12).background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel("Open native recovery")
                .padding()
            }
            .sheet(isPresented: $recoveryPresented) { RecoveryView(model: model) }
            .task { model.web.loadSelectedSource() }
    }
}

struct RecoveryView: View {
    @ObservedObject var model: AppHostModel
    @Environment(\.dismiss) private var dismiss
    @State private var developmentURL = ""
    @State private var message = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Authoritative web source") {
                    TextField("http://Mac-LAN-IP:3001", text: $developmentURL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Use development origin now") { configureDevelopment() }
                    Button("Use bundled build now") { restoreBundled() }
                    Button("Retry current source") { dismiss(); model.web.loadSelectedSource() }
                }
                Section("Native health") {
                    LabeledContent("Shell", value: "0.1.0 / protocol 1")
                    LabeledContent("Engine build", value: model.builds.active.buildId)
                    LabeledContent("Configured", value: model.builds.configuredSourceDescription)
                    LabeledContent("Load state", value: model.builds.uiLoadState)
                    LabeledContent("Target", value: model.builds.uiLoadTargetURL?.absoluteString ?? "None")
                    LabeledContent("Loaded", value: model.builds.loadedSourceDescription)
                    if let failure = model.builds.currentLoadFailure { Text(failure).foregroundStyle(.red) }
                    if let history = model.builds.lastFailureHistory { LabeledContent("Previous failure", value: history) }
                    Text("Workout recording is unavailable. Sensor status is passive; only explicit web diagnostics actions may request permission, start GPS, scan, or connect.")
                    Button("Export diagnostics") { export() }
                }
                if !message.isEmpty { Section { Text(message) } }
            }
            .navigationTitle("Native Recovery")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { developmentURL = model.builds.developmentURL?.absoluteString ?? "" }
        }
    }

    private func configureDevelopment() {
        do {
            _ = try model.builds.configureDevelopmentSource(developmentURL)
            message = "Development origin saved and loading."
            dismiss()
            model.web.loadSelectedSource()
        }
        catch { message = error.localizedDescription }
    }

    private func restoreBundled() {
        do {
            _ = try model.builds.configureDevelopmentSource(nil)
            message = "Bundled source selected and loading."
            dismiss()
            model.web.loadSelectedSource()
        }
        catch { message = error.localizedDescription }
    }

    private func export() {
        do {
            let result = try model.diagnostics.exportData(includeWorkoutObservations: false)
            message = model.dispatcher.presentShare?(result.url) == true ? "Share sheet opened." : "Unable to present share sheet."
        } catch { message = error.localizedDescription }
    }
}

private extension UIApplication {
    var topViewController: UIViewController? {
        let scene = connectedScenes.compactMap { $0 as? UIWindowScene }.first(where: { $0.activationState == .foregroundActive })
        var controller = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = controller?.presentedViewController { controller = presented }
        return controller
    }
}
