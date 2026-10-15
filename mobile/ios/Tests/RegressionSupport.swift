import Foundation

struct RegressionFailure: Error, CustomStringConvertible {
    let message: String
    let file: String
    let line: UInt
    var description: String { "\(file):\(line): \(message)" }
}

/// A missing test prerequisite ends the scenario through the report path, never a trap.
func testRequire<T>(_ value: T?, _ message: String,
                    file: String = #fileID, line: UInt = #line) throws -> T {
    guard let value else { throw RegressionFailure(message: message, file: file, line: line) }
    return value
}

func testCheck(_ value: @autoclosure () throws -> Bool, _ message: String = "Expectation failed",
               file: String = #fileID, line: UInt = #line) throws {
    guard try value() else { throw RegressionFailure(message: message, file: file, line: line) }
}
