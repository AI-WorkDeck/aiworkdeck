// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Temporary NEVER MERGE probe: no product code, no TCC changes, no installer.
import AppKit
import ApplicationServices
import CryptoKit

let env = ProcessInfo.processInfo.environment
precondition(env["GITHUB_ACTIONS"] == "true" && env["RUNNER_ENVIRONMENT"] == "github-hosted" && env["GITHUB_REPOSITORY"] == "AI-WorkDeck/aiworkdeck", "Disposable hosted runner only")
let mode = CommandLine.arguments[1]
let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
func save(_ name: String, _ data: [String: Any]) {
    try! JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys]).write(to: root.appendingPathComponent(name), options: .atomic)
}
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
let permission: [String: Any] = ["postEventAccess": CGPreflightPostEventAccess(), "accessibilityTrusted": AXIsProcessTrusted(), "pid": ProcessInfo.processInfo.processIdentifier]
if mode == "permissions" {
    save("permissions.json", permission)
    exit(CGPreflightPostEventAccess() ? 0 : 2)
}
if mode == "drive" {
    save("driver-permissions.json", permission)
    guard CGPreflightPostEventAccess() else { exit(2) }
    func point(_ name: String, _ key: String) -> CGPoint {
        let d = try! JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent(name))) as! [String: Any]
        let p = d[key] as! [String: Double]
        return CGPoint(x: p["x"]!, y: p["y"]!)
    }
    let source = CGEventSource(stateID: .hidSystemState)!
    func post(_ type: CGEventType, _ point: CGPoint) {
        let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)!
        e.setIntegerValueField(.eventSourceUserData, value: 1367)
        e.setIntegerValueField(.mouseEventClickState, value: 1)
        e.post(tap: .cghidEventTap)
    }
    let start = point("source-ready.json", "drag"), end = point("receiver-ready.json", "drop")
    // First activate the source via actual mouse click, then a distinct held drag.
    post(.mouseMoved, start); usleep(200000); post(.leftMouseDown, start); usleep(100000); post(.leftMouseUp, start); usleep(500000)
    post(.leftMouseDown, start); usleep(300000)
    for i in 1...60 {
        let t = Double(i) / 60
        post(.leftMouseDragged, CGPoint(x: start.x + (end.x-start.x)*t, y: start.y + (end.y-start.y)*t))
        usleep(30000)
    }
    usleep(300000); post(.leftMouseUp, end); usleep(1500000)
    let click = point("source-ready.json", "click")
    post(.mouseMoved, click); usleep(200000); post(.leftMouseDown, click); usleep(120000); post(.leftMouseUp, click)
    save("driver-finished.json", ["posted": true, "marker": 1367])
    exit(0)
}

class SourceView: NSView, NSDraggingSource {
    var started = false
    var lastDown: NSPoint = .zero
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemGreen.setFill(); NSRect(x:40,y:130,width:220,height:100).fill()
        NSColor.systemBlue.setFill(); NSRect(x:40,y:30,width:220,height:70).fill()
    }
    override func mouseDown(with event: NSEvent) {
        lastDown = convert(event.locationInWindow, from: nil)
        save("source-mousedown.json", ["marker":event.cgEvent?.getIntegerValueField(.eventSourceUserData) ?? -1])
    }
    override func mouseDragged(with event: NSEvent) {
        guard !started && NSRect(x:40,y:130,width:220,height:100).contains(lastDown) else { return }
        started = true
        let item = NSDraggingItem(pasteboardWriter: root.appendingPathComponent("fixture.txt") as NSURL)
        item.setDraggingFrame(NSRect(x:lastDown.x,y:lastDown.y,width:32,height:32), contents: NSImage(named: NSImage.folderName))
        beginDraggingSession(with: [item], event: event, source: self)
        save("source-dragstart.json", ["nativeSessionStarted":true])
    }
    override func mouseUp(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if NSRect(x:40,y:30,width:220,height:70).contains(p) {
            save("source-click-recovered.json", ["marker":event.cgEvent?.getIntegerValueField(.eventSourceUserData) ?? -1, "receivedMouseUp":true])
        }
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        save("source-dragend.json", ["operation":operation.rawValue]); started = false
    }
}
class ReceiverView: NSView {
    override func draw(_ dirtyRect: NSRect) { NSColor.systemOrange.setFill(); bounds.fill() }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { save("receiver-entered.json", ["sequence":sender.draggingSequenceNumber]); return .copy }
    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { true }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let files = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly:true]) as? [URL], files.count == 1 else { return false }
        do {
            let input = files[0], received = root.appendingPathComponent("received.txt")
            try FileManager.default.copyItem(at: input, to: received)
            let bytes = try Data(contentsOf: received)
            save("receiver-drop.json", ["name":input.lastPathComponent,"sha256":digest(bytes),"bytes":bytes.count,"pid":ProcessInfo.processInfo.processIdentifier])
            return true
        } catch { save("receiver-error.json", ["error":String(describing:error)]); return false }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let screen = NSScreen.screens[0].frame
precondition(screen.width >= 1000 && screen.height >= 600, "Need nonoverlapping GUI windows")
let isSource = mode == "source"
precondition(isSource || mode == "receiver")
let win = NSWindow(contentRect: NSRect(x:isSource ? 80 : 580,y:150,width:300,height:300), styleMask:[.titled,.closable], backing:.buffered, defer:false)
win.title = isSource ? "Native drag source" : "Native file receiver"
let view: NSView = isSource ? SourceView(frame:NSRect(x:0,y:0,width:300,height:300)) : ReceiverView(frame:NSRect(x:0,y:0,width:300,height:300))
if !isSource { view.registerForDraggedTypes([.fileURL]) }
win.contentView = view
win.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps:true)
func quartz(_ local: NSPoint) -> [String:Double] {
    let p = win.convertPoint(toScreen: view.convert(local,to:nil))
    return ["x":p.x,"y":screen.maxY-p.y]
}
DispatchQueue.main.asyncAfter(deadline:.now()+0.5) {
    save(isSource ? "source-ready.json" : "receiver-ready.json", ["pid":ProcessInfo.processInfo.processIdentifier,"drag":quartz(NSPoint(x:150,y:180)),"click":quartz(NSPoint(x:150,y:65)),"drop":quartz(NSPoint(x:150,y:180)),"screenWidth":screen.width,"screenHeight":screen.height])
}
app.run()
