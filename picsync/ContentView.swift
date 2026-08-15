import PhotosUI
import SwiftUI

struct ContentView: View {
    @State private var model = AppModel()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        DestinationsView(model: model)
                    } label: {
                        Label(model.profile == nil ? "Choose Upload Destination" : "Upload Destination", systemImage: "externaldrive.connected.to.line.below")
                    }

                    NavigationLink {
                        PhotoSelectionView(model: model)
                    } label: {
                        Label("Choose Photos", systemImage: "photo.on.rectangle.angled")
                    }
                    .disabled(model.profile == nil)
                } header: {
                    Text("New Sync")
                } footer: {
                    Text("PicSync exports original Photos resources to a folder you control. Keep the app open while a transfer is running; background completion is best effort.")
                }

                Section("Saved Destination") {
                    if let profile = model.profile {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(profile.host).font(.headline)
                            Text("\\\(profile.share)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(model.hasSavedPassword ? "Password saved securely in Keychain" : "Password needs to be entered")
                                .font(.caption)
                                .foregroundStyle(model.hasSavedPassword ? Color.secondary : Color.orange)
                        }
                    } else {
                        Text("No upload destination saved.").foregroundStyle(.secondary)
                    }
                }

                Section("Transfer Settings") {
                    Stepper("Parallel transfers: \(model.parallelism)", value: $model.parallelism, in: 1...20)
                    Text("Applied to new syncs and the next time a paused or failed sync resumes. Running workers are unchanged until you pause.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Support") {
                    NavigationLink {
                        DiagnosticsView()
                    } label: {
                        Label("Diagnostics Log", systemImage: "doc.text.magnifyingglass")
                    }
                }

                Section("Recent Runs") {
                    if model.runs.isEmpty {
                        ContentUnavailableView("No Syncs Yet", systemImage: "arrow.triangle.2.circlepath", description: Text("Choose a server and photos to create your first sync."))
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
            }
            .navigationTitle("PicSync")
            .task {
                await model.load()
                while !Task.isCancelled {
                    await model.refresh()
                    try? await Task.sleep(for: .seconds(1))
                }
            }
            .navigationDestination(isPresented: $model.presentsPhotoSelection) {
                PhotoSelectionView(model: model)
            }
        }
        .alert("PicSync", isPresented: Binding(get: { model.isShowingError }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK") { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
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

private struct DestinationsView: View {
    @Bindable var model: AppModel

    var body: some View {
        List {
            if model.profiles.isEmpty {
                ContentUnavailableView("No Destinations", systemImage: "externaldrive.badge.plus", description: Text("Add an SMB server and upload folder."))
            } else {
                Section {
                    ForEach(model.profiles) { profile in
                        HStack(spacing: 12) {
                            Button {
                                Task { await model.selectProfile(profile) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(profile.displayName).foregroundStyle(.primary)
                                        Text("\\\(profile.share)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if model.profile?.id == profile.id {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)

                            NavigationLink {
                                ServerProfileView(model: model, profile: profile)
                            } label: {
                                Image(systemName: "pencil").accessibilityLabel("Edit \(profile.displayName)")
                            }
                            .fixedSize()
                        }
                    }
                } footer: {
                    Text("Tap a destination to use it for new syncs. Existing runs keep their original destination.")
                }
            }
        }
        .navigationTitle("Destinations")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    ServerProfileView(model: model, profile: nil)
                } label: {
                    Label("Add Destination", systemImage: "plus")
                }
            }
        }
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

private struct ServerProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: AppModel
    let profile: ServerProfile?
    @State private var draft: ServerProfileDraft
    @State private var password = ""
    @State private var hasSavedPassword = false
    @State private var shares = [String]()
    @State private var isBrowsingShares = false
    @State private var didPrepareEditor = false

    init(model: AppModel, profile: ServerProfile?) {
        self.model = model
        self.profile = profile
        _draft = State(initialValue: ServerProfileDraft(profile))
    }

    private var connectionFields: String {
        [draft.host, String(draft.port), draft.username, draft.domain, String(draft.requiresSigning)].joined(separator: "\u{0}")
    }

    var body: some View {
        Form {
            Section("Connection") {
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
                TextField("Domain or workgroup", text: $draft.domain)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Section("Destination") {
                LabeledContent("Share", value: draft.share.isEmpty ? "Not selected" : draft.share)
                Button(model.isTestingConnection ? "Connecting..." : "Select Share") {
                    Task {
                        do {
                            shares = try await model.testConnection(draft: draft, password: password, editing: profile)
                            isBrowsingShares = true
                        } catch {
                            model.show(error)
                        }
                    }
                }
                .disabled(!draft.isValid || model.isTestingConnection)
                Toggle("Require SMB signing", isOn: $draft.requiresSigning)
            }
            Section {
                if let status = model.connectionStatus {
                    Label(status, systemImage: model.connectionVerified ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(model.connectionVerified ? .green : .red)
                }

                Button("Save Destination") {
                    Task {
                        do {
                            try await model.saveProfile(draft: draft, password: password, editing: profile)
                            dismiss()
                        } catch {
                            model.show(error)
                        }
                    }
                }
                .disabled(!draft.isValid || !model.connectionVerified || draft.share.isEmpty)
            } footer: {
                Text("Folders are selected separately for each sync. Passwords are saved only in the iOS Keychain. URLs containing a password are rejected.")
            }
        }
        .navigationTitle(profile == nil ? "Add Destination" : "Edit Destination")
        .task {
            guard !didPrepareEditor else { return }
            didPrepareEditor = true
            hasSavedPassword = model.savedPasswordExists(for: profile)
            await model.resetProfileEditor()
        }
        .onChange(of: connectionFields) { _, _ in model.resetConnectionVerification() }
        .onChange(of: password) { _, _ in model.resetConnectionVerification() }
        .navigationDestination(isPresented: $isBrowsingShares) {
            ShareBrowserView(draft: $draft, shares: shares, isBrowsingShares: $isBrowsingShares)
        }
    }
}

private struct ShareBrowserView: View {
    @Binding var draft: ServerProfileDraft
    let shares: [String]
    @Binding var isBrowsingShares: Bool

    var body: some View {
        List(shares, id: \.self) { share in
            Button {
                draft.share = share
                isBrowsingShares = false
            } label: {
                Label(share, systemImage: "externaldrive")
            }
        }
        .navigationTitle("Choose Share")
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

private struct PhotoSelectionView: View {
    @Bindable var model: AppModel
    @State private var selection = [String]()
    @State private var isCreatingRun = false
    @State private var hasPhotoAccess = false
    @State private var isPickingPhotos = false

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "photo.stack")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
            Text("Choose Photos")
                .font(.title2.weight(.semibold))
            Text("Select the photos and videos to copy. PicSync will request the original resources from your library when the sync starts.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            Button {
                isPickingPhotos = true
            } label: {
                Label(selection.isEmpty ? "Select Photos" : "\(selection.count) Selected", systemImage: "plus.rectangle.on.rectangle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)
            .disabled(!hasPhotoAccess)

            NavigationLink {
                AlbumPickerView(model: model)
            } label: {
                Label("Sync an Entire Album", systemImage: "rectangle.stack")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .padding(.horizontal)

            if !selection.isEmpty {
                Button("Review Sync") { isCreatingRun = true }
                    .buttonStyle(.bordered)
            }
            Spacer()
        }
        .padding(.top, 36)
        .navigationTitle("Source")
        .navigationDestination(isPresented: $isCreatingRun) {
            SyncReviewView(model: model, selectedIdentifiers: selection)
        }
        .sheet(isPresented: $isPickingPhotos) {
            PhotoPickerView { result in
                isPickingPhotos = false
                switch result {
                case .success(let identifiers):
                    selection = identifiers
                    AppLog.write("[Photos] picker returned identifiers=\(identifiers.count)")
                case .failure(let error):
                    model.show(error)
                }
            }
        }
        .task {
            do {
                try await PhotoLibraryService().requestAuthorization()
                hasPhotoAccess = true
                AppLog.write("[Photos] library access ready for individual selection")
            } catch { model.show(error) }
        }
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
    @State private var albums = [PhotoAlbum]()
    @State private var selectedAlbum: PhotoAlbum?

    var body: some View {
        List(albums) { album in
            Button { selectedAlbum = album } label: {
                HStack {
                    Image(systemName: album.isSmartAlbum ? "sparkles" : "rectangle.stack")
                    VStack(alignment: .leading) {
                        Text(album.title).foregroundStyle(.primary)
                        Text("\(album.count) items").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
            }
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
        .navigationDestination(item: $selectedAlbum) { AlbumReviewView(model: model, album: $0) }
    }
}

private struct AlbumReviewView: View {
    @Bindable var model: AppModel
    let album: PhotoAlbum
    @State private var run: SyncRun?
    @State private var isStarting = false
    @State private var destinationPath = ""
    @State private var hasSelectedFolder = false
    @State private var isBrowsingFolder = false

    var body: some View {
        Form {
            Section("Source") {
                LabeledContent("Album", value: album.title)
                LabeledContent("Snapshot", value: "\(album.count) current items")
                Text("The album is snapshotted when you start. Later album changes do not alter this sync.").font(.footnote).foregroundStyle(.secondary)
            }
            destinationSection
            Section("Transfer") { LabeledContent("Parallel transfers", value: "\(model.parallelism)") }
            Section {
                Button(isStarting ? "Starting..." : "Start Album Sync") {
                    Task {
                        isStarting = true
                        defer { isStarting = false }
                        do {
                            let createdRun = try await model.createAlbumRun(album, destinationPath: destinationPath, parallelism: model.parallelism)
                            run = createdRun
                            Task { await model.resume(runID: createdRun.id) }
                        } catch { model.show(error) }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isStarting || !hasSelectedFolder)
            }
        }
        .navigationTitle("Review Album")
        .navigationDestination(item: $run) { RunDetailView(model: model, run: $0) }
        .navigationDestination(isPresented: $isBrowsingFolder) {
            FolderBrowserView(model: model, share: model.profile?.share ?? "", path: "", isBrowsingFolder: $isBrowsingFolder) {
                destinationPath = $0
                hasSelectedFolder = true
            }
        }
    }

    @ViewBuilder private var destinationSection: some View {
        if let profile = model.profile {
            Section("Destination") {
                LabeledContent("Server", value: profile.host)
                LabeledContent("Share", value: profile.share)
                LabeledContent("Folder", value: hasSelectedFolder ? (destinationPath.isEmpty ? "/" : "/\(destinationPath)") : "Not selected")
                Button(hasSelectedFolder ? "Change Folder" : "Select Folder") { openFolderBrowser(profile) }
            }
        }
    }

    private func openFolderBrowser(_ profile: ServerProfile) {
        Task {
            do {
                try await model.openShare(profile: profile)
                isBrowsingFolder = true
            } catch { model.show(error) }
        }
    }
}

private struct SyncReviewView: View {
    @Bindable var model: AppModel
    let selectedIdentifiers: [String]
    @State private var run: SyncRun?
    @State private var isStarting = false
    @State private var destinationPath = ""
    @State private var hasSelectedFolder = false
    @State private var isBrowsingFolder = false

    var body: some View {
        Form {
            Section("Source") {
                LabeledContent("Selected items", value: "\(selectedIdentifiers.count)")
                Text("Original PhotoKit resources, including Live Photo and RAW companions when available.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let profile = model.profile {
                Section("Destination") {
                    LabeledContent("Server", value: profile.host)
                    LabeledContent("Share", value: profile.share)
                    LabeledContent("Folder", value: hasSelectedFolder ? (destinationPath.isEmpty ? "/" : "/\(destinationPath)") : "Not selected")
                    Button(hasSelectedFolder ? "Change Folder" : "Select Folder") { openFolderBrowser(profile) }
                }
            }
            Section("Transfer") {
                LabeledContent("Parallel transfers", value: "\(model.parallelism)")
                Text("iCloud-only originals need internet access. Keep PicSync active while syncing.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                Button(isStarting ? "Starting..." : "Start Sync") {
                    Task {
                        isStarting = true
                        defer { isStarting = false }
                        do {
                            let createdRun = try await model.createRun(identifiers: selectedIdentifiers, destinationPath: destinationPath, parallelism: model.parallelism)
                            run = createdRun
                            Task { await model.resume(runID: createdRun.id) }
                        }
                        catch { model.show(error) }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isStarting || !hasSelectedFolder)
            }
        }
        .navigationTitle("Review Sync")
        .navigationDestination(item: $run) { RunDetailView(model: model, run: $0) }
        .navigationDestination(isPresented: $isBrowsingFolder) {
            FolderBrowserView(model: model, share: model.profile?.share ?? "", path: "", isBrowsingFolder: $isBrowsingFolder) {
                destinationPath = $0
                hasSelectedFolder = true
            }
        }
    }

    private func openFolderBrowser(_ profile: ServerProfile) {
        Task {
            do {
                try await model.openShare(profile: profile)
                isBrowsingFolder = true
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
                ProgressView(value: currentRun.assetIdentifiers.isEmpty ? 0 : Double(finishedCount) / Double(currentRun.assetIdentifiers.count))
                LabeledContent("State", value: currentRun.state.displayName)
                LabeledContent("Active workers", value: "\(currentRun.activeWorkerCount ?? 0)")
                if currentRun.state.isResumable {
                    LabeledContent("Next resume limit", value: "\(model.parallelism)")
                }
                LabeledContent("Completed", value: "\(currentRun.completedCount)")
                LabeledContent("Skipped duplicates", value: "\(currentRun.skippedCount)")
                LabeledContent("Failed", value: "\(currentRun.failedCount)")
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
                    LabeledContent("Finishing active items", value: "Pausing")
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
                    Text(transfers.isEmpty ? "No transfer output yet." : "No asset errors recorded.")
                        .foregroundStyle(.secondary)
                } else {
                    DisclosureGroup("\(failures.count) failed items", isExpanded: $showsErrors) {
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
                        if failures.count > 5 {
                            Text("Showing the first 5 errors. \(failures.count - 5) additional items have the same run-level result.")
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
