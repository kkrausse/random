import PhotosUI
import SwiftUI

struct ContentView: View {
    @State private var model = AppModel()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        ServerProfileView(model: model)
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
                            Text("\\\(profile.share)\(profile.destinationPath.isEmpty ? "" : "/\(profile.destinationPath)")")
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

                if model.profiles.count > 1 {
                    Section("Other Saved Destinations") {
                        ForEach(model.profiles.dropFirst()) { profile in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(profile.displayName)
                                Text("\\\(profile.share)/\(profile.destinationPath)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section("Transfer Settings") {
                    Stepper("Parallel transfers: \(model.parallelism)", value: $model.parallelism, in: 1...20)
                    Text("Applied to all new syncs. Active and saved runs keep their original worker count.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
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
                    }
                }
            }
            .navigationTitle("PicSync")
            .task { await model.load() }
            .navigationDestination(isPresented: $model.presentsPhotoSelection) {
                PhotoSelectionView(model: model)
            }
            .alert("PicSync", isPresented: Binding(get: { model.isShowingError }, set: { if !$0 { model.errorMessage = nil } })) {
                Button("OK") { model.errorMessage = nil }
            } message: {
                Text(model.errorMessage ?? "")
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
    @State private var draft = ServerProfileDraft()
    @State private var password = ""
    @State private var shares = [String]()
    @State private var isBrowsingShares = false
    @State private var loadedDraft = false

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
                if model.hasSavedPassword {
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
                LabeledContent("Folder", value: draft.destinationPath.isEmpty ? "/" : "/\(draft.destinationPath)")
                Toggle("Require SMB signing", isOn: $draft.requiresSigning)
            }
            Section {
                Button(model.isTestingConnection ? "Connecting..." : "Connect and Choose Destination") {
                    Task {
                        do {
                            shares = try await model.testConnection(draft: draft, password: password)
                            isBrowsingShares = true
                        }
                        catch { model.show(error) }
                    }
                }
                .disabled(!draft.isValid || model.isTestingConnection)

                if let status = model.connectionStatus {
                    Label(status, systemImage: model.connectionVerified ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(model.connectionVerified ? .green : .red)
                }

                Button("Save Destination") {
                    Task {
                        do {
                            try await model.saveProfile(draft: draft, password: password)
                            dismiss()
                            model.presentsPhotoSelection = true
                        } catch {
                            model.show(error)
                        }
                    }
                }
                .disabled(!draft.isValid || !model.connectionVerified || draft.share.isEmpty)
            } footer: {
                Text("Connect as this user, choose a share, and browse to the existing upload folder. Passwords are saved only in the iOS Keychain. URLs containing a password are rejected.")
            }
        }
        .navigationTitle("Upload Destination")
        .onAppear {
            guard !loadedDraft else { return }
            draft = ServerProfileDraft(model.profile)
            loadedDraft = true
        }
        .navigationDestination(isPresented: $isBrowsingShares) {
            ShareBrowserView(model: model, draft: $draft, password: password, shares: shares, isBrowsingShares: $isBrowsingShares)
        }
    }
}

private struct ShareBrowserView: View {
    @Bindable var model: AppModel
    @Binding var draft: ServerProfileDraft
    let password: String
    let shares: [String]
    @Binding var isBrowsingShares: Bool
    @State private var selectedShare: String?

    var body: some View {
        List(shares, id: \.self) { share in
            Button {
                Task {
                    do {
                        try await model.openShare(share, draft: draft, password: password)
                        draft.share = share
                        draft.destinationPath = ""
                        selectedShare = share
                    } catch { model.show(error) }
                }
            } label: {
                Label(share, systemImage: "externaldrive")
            }
        }
        .navigationTitle("Choose Share")
        .navigationDestination(item: $selectedShare) { _ in
            FolderBrowserView(model: model, draft: $draft, path: "", isBrowsingShares: $isBrowsingShares)
        }
    }
}

private struct FolderBrowserView: View {
    @Bindable var model: AppModel
    @Binding var draft: ServerProfileDraft
    let path: String
    @Binding var isBrowsingShares: Bool
    @State private var items = [RemoteItem]()

    var body: some View {
        List {
            Section {
                Button("Use This Folder") {
                    draft.destinationPath = path
                    isBrowsingShares = false
                }
                .buttonStyle(.borderedProminent)
            } footer: {
                Text(path.isEmpty ? "The root of \\(draft.share)" : "/\(path)")
            }
            Section("Folders") {
                ForEach(items.filter(\.isDirectory)) { item in
                    NavigationLink {
                        FolderBrowserView(model: model, draft: $draft, path: item.path, isBrowsingShares: $isBrowsingShares)
                    } label: {
                        Label(item.name, systemImage: "folder")
                    }
                }
            }
        }
        .navigationTitle(path.isEmpty ? draft.share : URL(fileURLWithPath: path).lastPathComponent)
        .task {
            do { items = try await model.remoteDirectory(path: path) }
            catch { model.show(error) }
        }
    }
}

private struct PhotoSelectionView: View {
    @Bindable var model: AppModel
    @State private var selection: [PhotosPickerItem] = []
    @State private var isCreatingRun = false

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
            PhotosPicker(selection: $selection, maxSelectionCount: nil, matching: .any(of: [.images, .videos])) {
                Label(selection.isEmpty ? "Select Photos" : "\(selection.count) Selected", systemImage: "plus.rectangle.on.rectangle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)

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
            SyncReviewView(model: model, selectedItems: selection)
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

    var body: some View {
        Form {
            Section("Source") {
                LabeledContent("Album", value: album.title)
                LabeledContent("Snapshot", value: "\(album.count) current items")
                Text("The album is snapshotted when you start. Later album changes do not alter this sync.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("Transfer") { LabeledContent("Parallel transfers", value: "\(model.parallelism)") }
            Section {
                Button("Start Album Sync") {
                    Task {
                        do {
                            let createdRun = try await model.createAlbumRun(album, parallelism: model.parallelism)
                            run = createdRun
                            await model.resume(runID: createdRun.id)
                        } catch { model.show(error) }
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .navigationTitle("Review Album")
        .navigationDestination(item: $run) { RunDetailView(model: model, run: $0) }
    }
}

private struct SyncReviewView: View {
    @Bindable var model: AppModel
    let selectedItems: [PhotosPickerItem]
    @State private var run: SyncRun?

    var body: some View {
        Form {
            Section("Source") {
                LabeledContent("Selected items", value: "\(selectedItems.count)")
                Text("Original PhotoKit resources, including Live Photo and RAW companions when available.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let profile = model.profile {
                Section("Destination") {
                    LabeledContent("Server", value: profile.host)
                    LabeledContent("Share", value: profile.share)
                    LabeledContent("Folder", value: profile.destinationPath.isEmpty ? "/" : profile.destinationPath)
                }
            }
            Section("Transfer") {
                LabeledContent("Parallel transfers", value: "\(model.parallelism)")
                Text("iCloud-only originals need internet access. Keep PicSync active while syncing.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                Button("Start Sync") {
                    Task {
                        do {
                            let createdRun = try await model.createRun(items: selectedItems, parallelism: model.parallelism)
                            run = createdRun
                            await model.resume(runID: createdRun.id)
                        }
                        catch { model.show(error) }
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .navigationTitle("Review Sync")
        .navigationDestination(item: $run) { RunDetailView(model: model, run: $0) }
    }
}

private struct RunDetailView: View {
    @Bindable var model: AppModel
    let run: SyncRun
    @State private var showsErrors = false

    private var currentRun: SyncRun { model.runs.first { $0.id == run.id } ?? run }

    var body: some View {
        List {
            Section("Progress") {
                ProgressView(value: currentRun.totalBytes == 0 ? 0 : Double(currentRun.completedBytes) / Double(currentRun.totalBytes))
                LabeledContent("State", value: currentRun.state.displayName)
                LabeledContent("Completed", value: "\(currentRun.completedCount)")
                LabeledContent("Skipped duplicates", value: "\(currentRun.skippedCount)")
                LabeledContent("Failed", value: "\(currentRun.failedCount)")
            }
            Section("Actions") {
                if currentRun.state.isResumable {
                    Button(model.isResuming ? "Resuming..." : "Resume") { Task { await model.resume(runID: currentRun.id) } }
                        .disabled(model.isResuming)
                }
                if currentRun.state == .running {
                    Button("Pause") { Task { await model.pause(runID: currentRun.id) } }
                }
                if currentRun.failedCount > 0 {
                    Button("Retry Failed") { Task { await model.retryFailed(runID: currentRun.id) } }
                }
            }
            Section("Error Output") {
                let transfers = model.transferItems.filter { $0.runID == currentRun.id }
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
        .task(id: currentRun.id) { await model.loadTransfers(runID: currentRun.id) }
        .task(id: currentRun.id) {
            while !Task.isCancelled {
                await model.refreshRun(runID: currentRun.id)
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}

#Preview {
    ContentView()
}
