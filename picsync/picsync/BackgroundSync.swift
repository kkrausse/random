import BackgroundTasks
import Foundation
import Network

/// Keeps a sync the user started running after the app leaves the screen or the phone locks.
/// iOS shows its progress in the system UI; cancelling it there, or the system ending it, calls `onExpire`.
final class BackgroundSyncTask: @unchecked Sendable {
    private let lock = NSLock()
    private var task: AnyObject?
    private var latest: (done: Int64, total: Int64, subtitle: String)?
    private var finished = false

    /// Must be called while the app is in the foreground, in response to the user starting or resuming a sync.
    static func begin(title: String, onExpire: @escaping @Sendable () -> Void) -> BackgroundSyncTask? {
        guard #available(iOS 26.0, *) else { return nil }
        let handle = BackgroundSyncTask()
        // Each registration needs its own identifier; the Info.plist permits `<bundle id>.sync.*`.
        let identifier = "\(Bundle.main.bundleIdentifier ?? "picsync").sync.\(UUID().uuidString)"
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let task = task as? BGContinuedProcessingTask else { task.setTaskCompleted(success: false); return }
            task.expirationHandler = {
                AppLog.write("[Background] system ended the background sync")
                onExpire()
                handle.finish(success: false)
            }
            handle.attach(task)
        }
        guard registered else { AppLog.write("[Background] could not register \(identifier)"); return nil }
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: "Starting")
        request.strategy = .fail
        do {
            try BGTaskScheduler.shared.submit(request)
            AppLog.write("[Background] requested background sync")
            return handle
        } catch {
            AppLog.write("[Background] request refused error=\(String(reflecting: error))")
            return nil
        }
    }

    func update(done: Int64, total: Int64, subtitle: String) {
        guard #available(iOS 26.0, *) else { return }
        let task = lock.withLock { latest = (done, total, subtitle); return self.task as? BGContinuedProcessingTask }
        if let task { Self.apply(done: done, total: total, subtitle: subtitle, to: task) }
    }

    func finish(success: Bool) {
        guard #available(iOS 26.0, *) else { return }
        let task = lock.withLock { () -> BGContinuedProcessingTask? in
            guard !finished else { return nil }
            finished = true
            return self.task as? BGContinuedProcessingTask
        }
        task?.setTaskCompleted(success: success)
    }

    @available(iOS 26.0, *)
    private func attach(_ task: BGContinuedProcessingTask) {
        let (latest, finished) = lock.withLock { self.task = task; return (self.latest, self.finished) }
        // The run may have ended before iOS started the task.
        if finished { task.setTaskCompleted(success: true); return }
        if let latest { Self.apply(done: latest.done, total: latest.total, subtitle: latest.subtitle, to: task) }
    }

    @available(iOS 26.0, *)
    private static func apply(done: Int64, total: Int64, subtitle: String, to task: BGContinuedProcessingTask) {
        task.progress.totalUnitCount = max(total, 1)
        task.progress.completedUnitCount = min(done, max(total, 1))
        task.updateTitle(task.title, subtitle: subtitle)
    }
}

/// Reports when the phone has left Wi-Fi or wired Ethernet, so a sync never runs over cellular or a hotspot.
final class LocalNetworkWatch: @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "picsync.network-watch")
    private var leftAt: Date?

    /// `onLost` runs once the phone has been off a local network for `grace`, which rides out Wi-Fi roaming.
    init(grace: TimeInterval = 15, onLost: @escaping @Sendable (String) -> Void) {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let isLocal = path.status == .satisfied && !path.isExpensive && (path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet))
            guard !isLocal else { leftAt = nil; return }
            guard leftAt == nil else { return }
            let left = Date()
            leftAt = left
            AppLog.write("[Network] left Wi-Fi status=\(path.status) expensive=\(path.isExpensive)")
            queue.asyncAfter(deadline: .now() + grace) { [weak self] in
                guard let self, leftAt == left else { return }
                onLost("Paused because the phone is not on Wi-Fi. Resume when it is back on your home network.")
            }
        }
        monitor.start(queue: queue)
    }

    func stop() { monitor.cancel() }
}
