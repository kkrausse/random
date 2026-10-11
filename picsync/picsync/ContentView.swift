import PhotosUI
import SwiftUI

private enum SyncSource: Equatable {
    case album(PhotoAlbum)
    case photos([String])
}

struct ContentView: View {
    @State private var model = AppModel()
    @State private var source: SyncSource?
    @State private var isChoosingServer = false
    @State private var isChoosingDestination = false
    @State private var isChoosingAlbum = false
    @State private var isPickingPhotos = false
    @State private var shares = [String]()
    @State private var isLoadingShares = false
    @State private var isStarting = false
    @State private var startedRun: SyncRun?

    private var destinationLabel: String? {
        guard let profile = model.profile, !profile.share.isEmpty, let folder = model.destinationFolder else { return nil }
        return folder.isEmpty ? "\(profile.share)/" : "\(profile.share)/\(folder)"
    }

    private var missingSteps: [String] {
        var missing = [String]()
        if model.profile == nil { missing.append("a server") }
        if destinationLabel == nil { missing.append("a share and folder") }
        if source == nil { missing.append("photos") }
        return missing
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    FormRow(value: model.profile?.host, detail: serverDetail, placeholder: "Choose a server") { isChoosingServer = true }
                } header: {
                    Text("1. Server")
                }

                Section {
                    FormRow(value: destinationLabel, placeholder: "Choose a share and folder", isBusy: isLoadingShares, action: chooseDestination)
                        .disabled(model.profile == nil || isLoadingShares)
                } header: {
                    Text("2. Share and folder")
                }

                Section {
                    FormRow(value: albumLabel, placeholder: "Choose an album") { isChoosingAlbum = true }
                    FormRow(value: photosLabel, placeholder: "Or pick individual photos", action: pickPhotos)
                } header: {
                    Text("3. Photos")
                }

                Section {
                    Stepper("Parallel transfers: \(model.parallelism)", value: $model.parallelism, in: 1...20)
                    Stepper("Staging limit: \(model.stagingLimitGB) GB", value: $model.stagingLimitGB, in: 2...128, step: 2)
                } header: {
                    Text("4. Options")
                } footer: {
                    Text("Optional. Start with 2–4 parallel transfers on a Raspberry Pi. Staging includes originals retained by paused or failed runs; PicSync also preserves 2 GB of free iPhone storage. Changes apply to new syncs and the next time a paused or failed sync resumes.")
                }

                Section {
                    Button(action: start) {
                        Text(isStarting ? "Starting..." : "Start Sync").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .disabled(isStarting || !missingSteps.isEmpty || !model.activeRunIDs.isEmpty)
                } footer: {
                    Text(startFooter)
                }

                Section("Recent Runs") {
                    if model.runs.isEmpty {
                        Text("No syncs yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(model.runs) { run in
                            NavigationLink {
                                RunDetailView(model: model, run: run)
                            } label: {
                                RunRow(run: run)
                            }
                        }
                        .onDelete { offsets in
                            let runIDs = offsets.map { model.runs[$0].id }
                            Task {
                                for runID in runIDs { _ = await model.delete(runID: runID) }
                            }
                        }
                    }
                }

                Section("Support") {
                    NavigationLink {
                        DiagnosticsView()
                    } label: {
                        Label("Diagnostics Log", systemImage: "doc.text.magnifyingglass")
                    }
                }
            }
            .navigationTitle("PicSync")
            .task {
                await model.load()
                while !Task.isCancelled {
                    await model.refresh()
                    try? await Task.sleep(for: .seconds(1))
                }
            }
            .navigationDestination(isPresented: $isChoosingServer) {
                ServersView(model: model, isChoosingServer: $isChoosingServer)
            }
            .navigationDestination(isPresented: $isChoosingDestination) {
                ShareListView(model: model, shares: shares, isChoosingDestination: $isChoosingDestination)
            }
            .navigationDestination(isPresented: $isChoosingAlbum) {
                AlbumPickerView(model: model) {
                    source = .album($0)
                    isChoosingAlbum = false
                }
            }
            .navigationDestination(item: $startedRun) { RunDetailView(model: model, run: $0) }
            .sheet(isPresented: $isPickingPhotos) {
                PhotoPickerView { result in
                    isPickingPhotos = false
                    switch result {
                    case .success(let identifiers):
                        source = .photos(identifiers)
                        AppLog.write("[Photos] picker returned identifiers=\(identifiers.count)")
                    case .failure(let error):
                        model.show(error)
                    }
                }
            }
        }
        .alert("PicSync", isPresented: Binding(get: { model.isShowingError }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK") { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var serverDetail: String? {
        guard let profile = model.profile else { return nil }
        return model.hasSavedPassword ? "Signed in as \(profile.username)" : "Password needs to be entered"
    }

    private var albumLabel: String? {
        guard case .album(let album) = source else { return nil }
        return "\(album.title) (\(album.count) items)"
    }

    private var photosLabel: String? {
        guard case .photos(let identifiers) = source else { return nil }
        return "\(identifiers.count) selected"
    }

    private var startFooter: String {
        if !model.activeRunIDs.isEmpty { return "Another sync is running. Wait for it to finish or pause it first." }
        if !missingSteps.isEmpty { return "Still needed: \(missingSteps.formatted(.list(type: .and)))." }
        return "PicSync exports original Photos resources. Keep the app open while a transfer is running; background completion is best effort."
    }

    private func chooseDestination() {
        guard let profile = model.profile else { return }
        Task {
            isLoadingShares = true
            defer { isLoadingShares = false }
            do {
                shares = try await model.shares(of: profile)
                isChoosingDestination = true
            } catch { model.show(error) }
        }
    }

    private func pickPhotos() {
        Task {
            do {
                try await PhotoLibraryService().requestAuthorization()
                isPickingPhotos = true
            } catch { model.show(error) }
        }
    }

    private func start() {
        guard let source, let folder = model.destinationFolder else { return }
        Task {
            isStarting = true
            defer { isStarting = false }
            do {
                let run: SyncRun
                switch source {
                case .album(let album): run = try await model.createAlbumRun(album, destinationPath: folder, parallelism: model.parallelism)
                case .photos(let identifiers): run = try await model.createRun(identifiers: identifiers, destinationPath: folder, parallelism: model.parallelism)
                }
                self.source = nil
                startedRun = run
                Task { await model.resume(runID: run.id) }
            } catch { model.show(error) }
        }
    }
}

private struct FormRow: View {
    let value: String?
    var detail: String?
    let placeholder: String
    var isBusy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(value ?? placeholder).foregroundStyle(value == nil ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                    if let detail {
                        Text(detail).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if isBusy {
                    ProgressView()
                } else {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct DiagnosticsView: View {
    @State private var contents = ""

    var body: some View {
        ScrollView {
            Text(contents)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle("Diagnostics")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ShareLink(item: AppLog.fileURL) {
                    Label("Share Log", systemImage: "square.and.arrow.up")
                }
                Button("Clear", systemImage: "trash") {
                    AppLog.clear()
                    contents = AppLog.contents()
                }
            }
        }
        .task { contents = AppLog.contents() }
    }
}

private struct RunRow: View {
    let run: SyncRun

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(run.sourceLabel).font(.headline)
            Text("\(run.completedCount) complete, \(run.skippedCount) duplicates, \(run.failedCount) failed")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(run.state.displayName).font(.caption).foregroundStyle(run.state.tint)
        }
    }
}

private struct ServersView: View {
    @Bindable var model: AppModel
    @Binding var isChoosingServer: Bool

    /// Profiles are stored per share, so the same server can appear several times; list each server once.
    private var servers: [ServerProfile] {
        var servers = [ServerProfile]()
        for profile in model.profiles where !servers.contains(where: { $0.isSameServer(as: profile) }) {
            servers.append(model.profile.flatMap { $0.isSameServer(as: profile) ? $0 : nil } ?? profile)
        }
        return servers
    }

    var body: some View {
        List {
            if model.profiles.isEmpty {
                ContentUnavailableView("No Servers", systemImage: "externaldrive.badge.plus", description: Text("Add an SMB server to upload to."))
            } else {
                Section {
                    ForEach(servers) { server in
                        HStack(spacing: 12) {
                            Button {
                                Task {
                                    await model.selectProfile(server)
                                    isChoosingServer = false
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(server.host).foregroundStyle(.primary)
                                        Text(server.username)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if model.profile?.id == server.id {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)

                            NavigationLink {
                                ServerProfileView(model: model, profile: server) { isChoosingServer = false }
                            } label: {
                                Image(systemName: "pencil").accessibilityLabel("Edit \(server.host)")
                            }
                            .fixedSize()
                        }
                    }
                }
            }
            Section {
                NavigationLink {
                    ServerProfileView(model: model, profile: nil) { isChoosingServer = false }
                } label: {
                    Label("Add Server", systemImage: "plus")
                }
            }
        }
        .navigationTitle("Server")
    }
}

private struct ServerProfileView: View {
    @Bindable var model: AppModel
    let profile: ServerProfile?
    let onSaved: () -> Void
    @State private var draft: ServerProfileDraft
    @State private var password = ""
    @State private var hasSavedPassword = false
    @State private var didPrepareEditor = false

    init(model: AppModel, profile: ServerProfile?, onSaved: @escaping () -> Void) {
        self.model = model
        self.profile = profile
        self.onSaved = onSaved
        _draft = State(initialValue: ServerProfileDraft(profile))
    }

    private var connectionFields: String {
        [draft.host, String(draft.port), draft.username, draft.domain, String(draft.requiresSigning)].joined(separator: "\u{0}")
    }

    var body: some View {
        Form {
            Section {
                TextField("Server or smb:// URL", text: $draft.host)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Port", value: $draft.port, format: .number)
                    .keyboardType(.numberPad)
                TextField("Username", text: $draft.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                if hasSavedPassword {
                    Text("A password is saved securely. Enter a new value only to replace it.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                TextField("Domain or workgroup (optional)", text: $draft.domain)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Toggle("Require SMB signing", isOn: $draft.requiresSigning)
            } footer: {
                Text("Passwords are saved only in the iOS Keychain. URLs containing a password are rejected.")
            }
            Section {
                if let status = model.connectionStatus {
                    Label(status, systemImage: model.connectionVerified ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(model.connectionVerified ? .green : .red)
                }

                Button(model.isTestingConnection ? "Connecting..." : "Connect and Save") {
                    Task {
                        do {
                            _ = try await model.testConnection(draft: draft, password: password, editing: profile)
                            try await model.saveProfile(draft: draft, password: password, editing: profile)
                            onSaved()
                        } catch {
                            model.show(error)
                        }
                    }
                }
                .disabled(!draft.isValid || model.isTestingConnection)
            } footer: {
                Text("PicSync signs in to check the details before saving. You choose the share and folder in the next step.")
            }
        }
        .navigationTitle(profile == nil ? "Add Server" : "Edit Server")
        .task {
            guard !didPrepareEditor else { return }
            didPrepareEditor = true
            hasSavedPassword = model.savedPasswordExists(for: profile)
            await model.resetProfileEditor()
        }
        .onChange(of: connectionFields) { _, _ in model.resetConnectionVerification() }
        .onChange(of: password) { _, _ in model.resetConnectionVerification() }
    }
}

private struct ShareListView: View {
    @Bindable var model: AppModel
    let shares: [String]
    @Binding var isChoosingDestination: Bool
    @State private var openingShare: String?
    @State private var openedShare: String?

    var body: some View {
        List(shares, id: \.self) { share in
            Button {
                open(share)
            } label: {
                HStack {
                    Label(share, systemImage: "externaldrive")
                    Spacer()
                    if openingShare == share {
                        ProgressView()
                    } else if model.profile?.share == share {
                        Image(systemName: "checkmark").foregroundStyle(.tint)
                    }
                }
            }
            .disabled(openingShare != nil)
        }
        .overlay { if shares.isEmpty { ContentUnavailableView("No Shares", systemImage: "externaldrive", description: Text("This server did not list any shares for your account.")) } }
        .navigationTitle("Choose Share")
        .navigationDestination(item: $openedShare) { share in
            FolderBrowserView(model: model, share: share, path: "", isBrowsingFolder: $isChoosingDestination) { path in
                Task {
                    do { try await model.useDestination(share: share, folder: path) }
                    catch { model.show(error) }
                }
            }
        }
    }

    private func open(_ share: String) {
        guard var target = model.profile else { return }
        target.share = share
        let shareProfile = target
        Task {
            openingShare = share
            defer { openingShare = nil }
            do {
                try await model.openShare(profile: shareProfile)
                openedShare = share
            } catch { model.show(error) }
        }
    }
}

private struct FolderBrowserView: View {
    @Bindable var model: AppModel
    let share: String
    let path: String
    @Binding var isBrowsingFolder: Bool
    let onSelect: (String) -> Void
    @State private var items = [RemoteItem]()
    @State private var newFolderName = ""
    @State private var isNamingFolder = false

    var body: some View {
        List {
            Section {
                Button("Use This Folder") {
                    onSelect(path)
                    isBrowsingFolder = false
                }
                .buttonStyle(.borderedProminent)
                Button {
                    newFolderName = ""
                    isNamingFolder = true
                } label: {
                    Label("New Folder", systemImage: "folder.badge.plus")
                }
            } footer: {
                Text(path.isEmpty ? "The root of \(share)" : "/\(path)")
            }
            Section("Folders") {
                ForEach(items.filter(\.isDirectory)) { item in
                    NavigationLink {
                        FolderBrowserView(model: model, share: share, path: item.path, isBrowsingFolder: $isBrowsingFolder, onSelect: onSelect)
                    } label: {
                        Label(item.name, systemImage: "folder")
                    }
                }
            }
        }
        .navigationTitle(path.isEmpty ? share : URL(fileURLWithPath: path).lastPathComponent)
        .task {
            await loadItems()
        }
        .alert("New Folder", isPresented: $isNamingFolder) {
            TextField("Folder name", text: $newFolderName)
            Button("Cancel", role: .cancel) {}
            Button("Create") {
                Task {
                    do {
                        try await model.createRemoteDirectory(parentPath: path, name: newFolderName)
                        await loadItems()
                    } catch {
                        model.show(error)
                    }
                }
            }
        } message: {
            Text(path.isEmpty ? "Create a folder in the root of \(share)." : "Create a folder in /\(path).")
        }
    }

    private func loadItems() async {
        do { items = try await model.remoteDirectory(path: path) }
        catch { model.show(error) }
    }
}

private struct PhotoPickerView: UIViewControllerRepresentable {
    let completion: (Result<[String], Error>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .any(of: [.images, .videos])
        configuration.selectionLimit = 0
        let controller = PHPickerViewController(configuration: configuration)
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let completion: (Result<[String], Error>) -> Void

        init(completion: @escaping (Result<[String], Error>) -> Void) {
            self.completion = completion
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !results.isEmpty else {
                picker.dismiss(animated: true)
                return
            }
            let identifiers = results.compactMap(\.assetIdentifier)
            completion(identifiers.count == results.count ? .success(identifiers) : .failure(PicSyncError.pickerIdentifierUnavailable))
        }
    }
}

private struct AlbumPickerView: View {
    @Bindable var model: AppModel
    let onSelect: (PhotoAlbum) -> Void
    @State private var albums = [PhotoAlbum]()

    var body: some View {
        List(albums) { album in
            Button { onSelect(album) } label: {
                HStack {
                    Image(systemName: album.isSmartAlbum ? "sparkles" : "rectangle.stack")
                    VStack(alignment: .leading) {
                        Text(album.title).foregroundStyle(.primary)
                        Text(album.isCloudShared ? "Shared Album - reduced copies only, cannot be synced" : "\(album.count) items")
                            .font(.caption)
                            .foregroundStyle(album.isCloudShared ? .orange : .secondary)
                    }
                }
            }
            .disabled(album.isCloudShared)
            .accessibilityLabel("\(album.title), \(album.count) items")
        }
        .overlay { if albums.isEmpty { ContentUnavailableView("No Albums", systemImage: "rectangle.stack", description: Text("Allow Photos access to browse your albums.")) } }
        .navigationTitle("Choose Album")
        .task {
            do {
                try await PhotoLibraryService().requestAuthorization()
                albums = try PhotoLibraryService().albums()
            } catch { model.show(error) }
        }
    }
}

private struct RunDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: AppModel
    let run: SyncRun
    @State private var showsErrors = false

    private var currentRun: SyncRun { model.runs.first { $0.id == run.id } ?? run }

    var body: some View {
        List {
            Section("Progress") {
                let finishedCount = currentRun.completedCount + currentRun.skippedCount + currentRun.failedCount
                ProgressView(value: currentRun.itemCount == 0 ? 0 : Double(finishedCount) / Double(currentRun.itemCount))
                LabeledContent("Assets", value: "\(finishedCount) / \(currentRun.itemCount)")
                LabeledContent("State", value: currentRun.state.displayName)
                LabeledContent("Active workers", value: "\(currentRun.activeWorkerCount ?? 0)")
                if currentRun.state.isResumable {
                    LabeledContent("Next resume limit", value: "\(model.parallelism)")
                }
                LabeledContent("Copied", value: "\(currentRun.completedCount)")
                LabeledContent("Skipped duplicates", value: "\(currentRun.skippedCount)")
                LabeledContent("Failed", value: "\(currentRun.failedCount)")
                LabeledContent("Copied or already managed", value: ByteCountFormatter.string(fromByteCount: currentRun.completedBytes, countStyle: .file))
                LabeledContent("Bytes discovered so far", value: ByteCountFormatter.string(fromByteCount: currentRun.totalBytes, countStyle: .file))
                Text("Copied files are size-checked. Run the Pi-side verifier for a full SHA-256 integrity check; copied does not yet mean checksum-verified.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let reason = currentRun.pauseReason {
                    Text(reason).foregroundStyle(.orange).textSelection(.enabled)
                }
            }
            if let progress = model.progressByRun[currentRun.id], !progress.items.isEmpty {
                Section("Active Transfers") {
                    LabeledContent("Upload speed", value: "\(ByteCountFormatter.string(fromByteCount: Int64(progress.bytesPerSecond), countStyle: .file))/s")
                    ForEach(progress.items) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.filename).lineLimit(1)
                            Text(item.phase).font(.caption).foregroundStyle(.secondary)
                            if item.total > 0 {
                                ProgressView(value: Double(item.bytes), total: Double(item.total))
                                Text("\(ByteCountFormatter.string(fromByteCount: item.bytes, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: item.total, countStyle: .file))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            Section("Actions") {
                if currentRun.state.isResumable {
                    Button("Resume") { Task { await model.resume(runID: currentRun.id) } }
                        .disabled(!model.activeRunIDs.isEmpty)
                }
                if currentRun.state == .running {
                    Button("Pause") { Task { await model.pause(runID: currentRun.id) } }
                }
                if currentRun.state == .pausing {
                    LabeledContent("Checkpointing active items", value: "Pausing")
                }
                Button("Delete Run", role: .destructive) {
                    Task {
                        if await model.delete(runID: currentRun.id) { dismiss() }
                    }
                }
                .disabled(model.activeRunIDs.contains(currentRun.id))
            }
            Section("Error Output") {
                let transfers = model.transfers(for: currentRun.id)
                let failures = transfers.filter { $0.state == .failed }
                if failures.isEmpty {
                    Text("No asset errors recorded.")
                        .foregroundStyle(.secondary)
                } else {
                    DisclosureGroup("\(currentRun.failedCount) failed items", isExpanded: $showsErrors) {
                        ForEach(failures.prefix(5)) { transfer in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(transfer.manifest.first?.filename ?? "Photo item")
                                Text(transfer.errorMessage ?? "Unknown error")
                                    .font(.caption)
                                    .foregroundStyle(.red)
                                    .textSelection(.enabled)
                            }
                            .padding(.vertical, 3)
                        }
                        if currentRun.failedCount > 5 {
                            Text("Showing 5 of \(currentRun.failedCount) errors. Resume retries failed items.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(currentRun.sourceLabel)
        .task(id: currentRun.id) {
            while !Task.isCancelled {
                await model.refresh()
                await model.loadTransfers(runID: currentRun.id)
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

}

#Preview {
    ContentView()
}
