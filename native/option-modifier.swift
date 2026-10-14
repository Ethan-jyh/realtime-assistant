import Foundation
import CoreGraphics
// Read only the Option modifier flag. No event tap, key codes, text or recording.
var last: Bool? = nil
var lastSent = Date.distantPast
while true {
    let held = CGEventSource.flagsState(.combinedSessionState).contains(.maskAlternate)
    if held != last || Date().timeIntervalSince(lastSent) >= 1 {
        print(held ? "1" : "0")
        fflush(stdout)
        last = held
        lastSent = Date()
    }
    Thread.sleep(forTimeInterval: 0.03)
}
