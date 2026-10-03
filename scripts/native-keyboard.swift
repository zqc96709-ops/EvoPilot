import CoreGraphics
import Foundation

let text = CommandLine.arguments.dropFirst().joined(separator: " ")
let source = CGEventSource(stateID: .hidSystemState)
for unit in text.utf16 {
  var letter = unit
  let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)!
  down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &letter)
  down.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)!
  up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &letter)
  up.post(tap: .cghidEventTap)
  usleep(20000)
}
