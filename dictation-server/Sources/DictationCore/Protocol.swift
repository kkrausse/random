import Foundation
import CoreFoundation

package let modelID = "parakeet-unified-en-0.6b-streaming-1120ms"
package let audioFormat: [String: Any] = ["sampleRate": 16000, "channels": 1, "format": "f32le"]
package let queueLimit = 128_000
package let frameLimit = 6_400

package struct ProtocolFailure: Error {
    let code: String
    package init(_ code: String) { self.code = code }
}

func validateStart(_ value: [String: Any]) throws -> String {
    func number(_ key: String, _ expected: Int) -> Bool {
        guard let value = value[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else { return false }
        return value.doubleValue == Double(expected)
    }
    guard value["type"] as? String == "start", number("version", 1),
          let id = value["recordingId"] as? String, UUID(uuidString: id) != nil,
          number("sampleRate", 16000), number("channels", 1),
          value["format"] as? String == "f32le" else { throw ProtocolFailure("invalid_start") }
    return id
}

func decodeAudio(_ data: Data) throws -> [Float] {
    guard !data.isEmpty, data.count <= frameLimit, data.count % 4 == 0 else {
        throw ProtocolFailure("invalid_audio")
    }
    return try data.withUnsafeBytes { bytes in
        try stride(from: 0, to: data.count, by: 4).map { offset in
            let sample = Float(bitPattern: UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self)))
            guard sample.isFinite else { throw ProtocolFailure("invalid_audio") }
            return sample
        }
    }
}
