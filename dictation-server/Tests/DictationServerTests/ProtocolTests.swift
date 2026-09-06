import XCTest
@testable import DictationCore

final class ProtocolTests: XCTestCase {
    func testFloatValidation() throws {
        let bytes = Data([0, 0, 128, 63, 0, 0, 0, 191])
        XCTAssertEqual(try decodeAudio(bytes), [1, -0.5])
        for invalid in [Data(), Data([0]), Data(repeating: 0, count: 6404), Data([0, 0, 128, 127]), Data([0, 0, 192, 127])] {
            XCTAssertThrowsError(try decodeAudio(invalid))
        }
    }
    func testStartFormat() throws {
        var value: [String: Any] = ["type": "start", "version": 1, "recordingId": UUID().uuidString,
                                    "sampleRate": 16000, "channels": 1, "format": "f32le"]
        XCTAssertNoThrow(try validateStart(value))
        value["sampleRate"] = 48000
        XCTAssertThrowsError(try validateStart(value))
        value["sampleRate"] = 16000
        value["version"] = true
        XCTAssertThrowsError(try validateStart(value))
    }
}
