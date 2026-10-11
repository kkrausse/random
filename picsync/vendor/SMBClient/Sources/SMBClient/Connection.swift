import Foundation
import Network

/// iOS can route a LAN connection over Wi-Fi while an Ethernet adapter is attached. When a wired
/// interface has a usable path, connections are pinned to it; otherwise the system chooses.
enum WiredPath {
  private static let lock = NSLock()
  private static var isSatisfied = false
  private static var hasFirstUpdate = false
  private static let firstUpdate = DispatchSemaphore(value: 0)
  private static let monitor: NWPathMonitor = {
    let monitor = NWPathMonitor(requiredInterfaceType: .wiredEthernet)
    monitor.pathUpdateHandler = { path in
      let isFirst = lock.withLock {
        isSatisfied = path.status == .satisfied
        defer { hasFirstUpdate = true }
        return !hasFirstUpdate
      }
      if isFirst { firstUpdate.signal() }
    }
    monitor.start(queue: .global(qos: .utility))
    return monitor
  }()

  static func parameters() -> NWParameters {
    _ = monitor
    if !lock.withLock({ hasFirstUpdate }) { _ = firstUpdate.wait(timeout: .now() + 0.5) }
    let parameters = NWParameters.tcp
    if lock.withLock({ isSatisfied }) { parameters.requiredInterfaceType = .wiredEthernet }
    return parameters
  }
}

public class Connection {
  let host: String
  var onDisconnected: (Error) -> Void

  private let connection: NWConnection
  private var buffer = Data()

  private let semaphore = Semaphore(value: 1)

  public var state: NWConnection.State {
    connection.state
  }

  public init(host: String) {
    self.host = host
    let endpoint = NWEndpoint.hostPort(
      host: NWEndpoint.Host(host),
      port: NWEndpoint.Port(integerLiteral: 445)
    )
    connection = NWConnection(to: endpoint, using: WiredPath.parameters())
    onDisconnected = { _ in }
  }

  public init(host: String, port: Int) {
    self.host = host
    let endpoint = NWEndpoint.hostPort(
      host: NWEndpoint.Host(host),
      port: NWEndpoint.Port(rawValue: UInt16(port))!
    )
    connection = NWConnection(to: endpoint, using: WiredPath.parameters())
    onDisconnected = { _ in }
  }

  /// The interface the connection ended up on, such as "wiredEthernet en5".
  public var interfaceDescription: String {
    guard let interface = connection.currentPath?.availableInterfaces.first else { return "unknown" }
    return "\(interface.type) \(interface.name)"
  }

  public func connect() async throws {
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation) in
        connection.stateUpdateHandler = { (state) in
          switch state {
          case .setup, .preparing:
            break
          case .waiting(let error):
            continuation.resume(throwing: error)
            self.connection.stateUpdateHandler = nil
          case .ready:
            continuation.resume()
            self.connection.stateUpdateHandler = stateUpdateHandler
          case .failed(let error):
            continuation.resume(throwing: error)
            self.connection.stateUpdateHandler = nil
          case .cancelled:
            continuation.resume(throwing: ConnectionError.cancelled)
            self.connection.stateUpdateHandler = nil
          @unknown default:
            break
          }
        }

        connection.start(queue: .global(qos: .userInitiated))
      }
    } onCancel: {
      connection.cancel()
    }

    @Sendable
    func stateUpdateHandler(_ state: NWConnection.State) {
      switch state {
      case .waiting(let error), .failed(let error):
        onDisconnected(error)
      case .setup, .preparing, .ready, .cancelled:
        break
      @unknown default:
        break
      }
    }
  }

  public func disconnect() {
    connection.cancel()
  }

  public func send(_ data: Data) async throws -> Data {
    try await withThrowingTaskGroup(of: Data.self) { group in
      group.addTask { try await self.sendRequest(data) }
      group.addTask {
        try await Task.sleep(nanoseconds: 30_000_000_000)
        throw URLError(.timedOut)
      }
      defer { group.cancelAll() }
      return try await group.next()!
    }
  }

  private func sendRequest(_ data: Data) async throws -> Data {
    try await withTaskCancellationHandler {
      await semaphore.wait()
      defer { Task { await semaphore.signal() } }

      switch connection.state {
      case .setup:
        try await connect()
      case .waiting(let error), .failed(let error):
        onDisconnected(error)
        throw error
      case .preparing, .ready:
        break
      case .cancelled:
        throw ConnectionError.cancelled
      @unknown default:
        throw ConnectionError.unknown
      }

      let transportPacket = DirectTCPPacket(smb2Message: data)
      let content = transportPacket.encoded()

      return try await withCheckedThrowingContinuation { (continuation) in
        connection.send(content: content, completion: .contentProcessed() { (error) in
          if let error {
            continuation.resume(throwing: error)
            return
          }

          self.receive() { (result) in
            switch result {
            case .success(let data):
              continuation.resume(returning: data)
            case .failure(let error):
              continuation.resume(throwing: error)
            }
          }
        })
      }
    } onCancel: {
      connection.cancel()
    }
  }

  private func receive(completion: @escaping (Result<Data, Error>) -> Void) {
    let minimumIncompleteLength = 4
    let maximumLength = 65536

    connection.receive(
      minimumIncompleteLength: minimumIncompleteLength,
      maximumLength: maximumLength)
    { (content, contentContext, isComplete, error) in
      if let error = error {
        completion(.failure(error))
        return
      }

      guard let content else {
        if isComplete {
          completion(.failure(ConnectionError.disconnected))
        } else {
          completion(.failure(ConnectionError.noData))
        }
        return
      }

      guard content.count >= 4 else {
        completion(.failure(ConnectionError.noData))
        return
      }
      let transportPacket = DirectTCPPacket(response: content)
      let length = Int(transportPacket.protocolLength)

      self.buffer.append(Data(transportPacket.smb2Message))

      self.receive(upTo: length) { (result) in
        switch result {
        case .success:
          let data = Data(self.buffer.prefix(length))
          self.buffer = Data(self.buffer.suffix(from: length))

          let reader = ByteReader(data)
          var offset = 0

          var header: Header
          var response = Data()
          repeat {
            header = reader.read()

            switch NTStatus(header.status) {
            case
              .success,
              .moreProcessingRequired,
              .noMoreFiles,
              .endOfFile:
              response += data
            case .pending:
              if self.buffer.count > 0 {
                let transportPacket = DirectTCPPacket(response: self.buffer)
                let length = Int(transportPacket.protocolLength)

                if self.buffer.count < length {
                  self.receive(completion: completion)
                  return
                }

                let data = transportPacket.smb2Message
                self.buffer = Data(self.buffer.suffix(from: 4 + length))

                let reader = ByteReader(data)
                let header: Header = reader.read()

                switch NTStatus(header.status) {
                case
                  .success,
                  .moreProcessingRequired,
                  .noMoreFiles,
                  .endOfFile:
                  response += data
                  break
                default:
                  completion(.failure(ErrorResponse(data: data)))
                  return
                }
              } else {
                self.receive(completion: completion)
                return
              }
            default:
              completion(.failure(ErrorResponse(data: Data(data[offset...]))))
              return
            }

            offset += Int(header.nextCommand)
            reader.seek(to: offset)
          } while header.nextCommand > 0

          completion(.success(response))
        case .failure(let error):
          completion(.failure(error))
        }
      }
    }
  }

  private func receive(upTo byteCount: Int, completion: @escaping (Result<(), Error>) -> Void) {
    let minimumIncompleteLength = 0
    let maximumLength = 65536

    if self.buffer.count < byteCount {
      self.connection.receive(minimumIncompleteLength: minimumIncompleteLength, maximumLength: maximumLength) { (data, _, isComplete, error) in
        if let error = error {
          completion(.failure(error))
          return
        }

        guard let data else {
          if isComplete {
            completion(.failure(ConnectionError.disconnected))
          } else {
            completion(.failure(ConnectionError.noData))
          }
          return
        }

        self.buffer.append(data)
        self.receive(upTo: byteCount, completion: completion)
      }
      return
    }

    completion(.success(()))
  }
}

public enum ConnectionError: Error {
  case noData
  case disconnected
  case cancelled
  case unknown
}
