// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Disposable runner helper. Real Quartz mouse stream and independent AppKit file receiver.
import AppKit
import ApplicationServices
import CryptoKit
let env = ProcessInfo.processInfo.environment
precondition(env["GITHUB_ACTIONS"] == "true" && env["RUNNER_ENVIRONMENT"] == "github-hosted" && env["GITHUB_REPOSITORY"] == "AI-WorkDeck/aiworkdeck", "Disposable hosted runner only")
let mode = CommandLine.arguments[1]
let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
func save(_ name: String, _ data: [String: Any]) {
    try! JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted,.sortedKeys]).write(to:root.appendingPathComponent(name), options:.atomic)
}
func sha(_ data: Data) -> String { SHA256.hash(data:data).map { String(format:"%02x",$0) }.joined() }
let permissions: [String:Any] = ["postEventAccess":CGPreflightPostEventAccess(),"accessibilityTrusted":AXIsProcessTrusted(),"screenCaptureAccess":CGPreflightScreenCaptureAccess(),"pid":ProcessInfo.processInfo.processIdentifier]
if mode == "permissions" { save("permissions.json",permissions); exit(CGPreflightPostEventAccess() ? 0 : 2) }
if mode == "mouse" {
    let mouseApp=NSApplication.shared
    mouseApp.setActivationPolicy(.prohibited) // Initialize AppKit without creating/activating a helper window.
    mouseApp.finishLaunching()
    let cfg = try! JSONSerialization.jsonObject(with:Data(CommandLine.arguments[3].utf8)) as! [String:Any]
    let label = cfg["label"] as! String
    save("\(label)-permissions.json",permissions)
    precondition(CGPreflightPostEventAccess(),"Native event permission missing; no prompt or TCC mutation")
    let expectedPid = cfg["sourcePid"] as! Int32
    NSRunningApplication(processIdentifier:expectedPid)?.activate(options:[.activateIgnoringOtherApps])
    usleep(250000)
    func point(_ key:String) -> CGPoint {
        let p=cfg[key] as! [String:Double]; return CGPoint(x:p["x"]!,y:p["y"]!)
    }
    func owner(_ point:CGPoint) -> Int32 {
        // AppKit uses real mouse-down hit-testing, ignoring transparent/click-through
        // system tracking windows (a rectangular CGWindow scan can falsely hit Dock).
        let screenPoint=NSPoint(x:point.x,y:NSScreen.screens[0].frame.maxY-point.y)
        let number=NSWindow.windowNumber(at:screenPoint,belowWindowWithWindowNumber:0)
        let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as! [[String:Any]]
        let matched=windows.first { ($0[kCGWindowNumber as String] as? Int)==number }
        let pid=Int32(matched?[kCGWindowOwnerPID as String] as? Int ?? -1)
        save("\(label)-window-at-\(Int(point.x))-\(Int(point.y)).json",["windowNumber":number,"ownerPid":pid,"appKitPoint":["x":screenPoint.x,"y":screenPoint.y],"windows":windows.map { w in w.filter { [kCGWindowNumber,kCGWindowOwnerPID,kCGWindowOwnerName,kCGWindowBounds,kCGWindowLayer,kCGWindowAlpha].map { $0 as String }.contains($0.key) } }])
        return pid
    }
    let start=point("source"); let startOwner=owner(start)
    var record:[String:Any] = ["sourceOwner":startOwner,"expectedSourceOwner":expectedPid,"source":cfg["source"]!,"action":cfg["action"]!]
    save("\(label)-hit-test.json",record)
    precondition(startOwner==expectedPid,"Source point is occluded or in another native window")
    let state=CGEventSource(stateID:.hidSystemState)!
    func post(_ type:CGEventType,_ p:CGPoint) {
        let e=CGEvent(mouseEventSource:state,mouseType:type,mouseCursorPosition:p,mouseButton:.left)!
        e.setIntegerValueField(.eventSourceUserData,value:1367);e.setIntegerValueField(.mouseEventClickState,value:1);e.post(tap:.cghidEventTap)
    }
    post(.mouseMoved,start);usleep(1200000) // Real hover primes the product's native path cache.
    if cfg["action"] as! String == "drag" {
        let end=point("destination");let endOwner=owner(end);record["destinationOwner"]=endOwner;record["destination"]=cfg["destination"]!
        save("\(label)-hit-test.json",record)
        precondition(endOwner==cfg["destinationPid"] as! Int32,"Receiver point is occluded")
        post(.leftMouseDown,start);usleep(200000)
        for i in 1...60 { let t=Double(i)/60;post(.leftMouseDragged,CGPoint(x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t));usleep(30000) }
        usleep(400000);post(.leftMouseUp,end)
    } else { post(.leftMouseDown,start);usleep(100000);post(.leftMouseUp,start) }
    usleep(300000);save("\(label)-posted.json",["actualCGEventStream":true,"marker":1367]);exit(0)
}
precondition(mode=="receiver")
class ReceiverView:NSView {
    var count=0
    override func draw(_ dirtyRect:NSRect) {
        NSColor.systemOrange.setFill();bounds.fill()
        let text="Native receiver: \(count) file drops" as NSString
        text.draw(at:NSPoint(x:14,y:80),withAttributes:[.font:NSFont.systemFont(ofSize:16),.foregroundColor:NSColor.black])
    }
    override func draggingEntered(_ sender:NSDraggingInfo)->NSDragOperation { save("receiver-entered-\(count+1).json",["nativeDraggingInfo":true]);return .copy }
    override func prepareForDragOperation(_ sender:NSDraggingInfo)->Bool { true }
    override func performDragOperation(_ sender:NSDraggingInfo)->Bool {
        guard let urls=sender.draggingPasteboard.readObjects(forClasses:[NSURL.self],options:[.urlReadingFileURLsOnly:true]) as? [URL],urls.count==1 else { return false }
        do {
            count += 1
            let source=urls[0],copy=root.appendingPathComponent("copy-\(count)-\(source.lastPathComponent)")
            try FileManager.default.copyItem(at:source,to:copy)
            let bytes=try Data(contentsOf:copy)
            save("received-\(count).json",["nativeFileURLs":true,"name":source.lastPathComponent,"source":source.path,"copy":copy.path,"sha256":sha(bytes),"bytes":bytes.count,"pid":ProcessInfo.processInfo.processIdentifier,"formats":sender.draggingPasteboard.types?.map{$0.rawValue} ?? []])
            needsDisplay=true;return true
        } catch { save("receiver-error.json",["error":String(describing:error)]);return false }
    }
}
let app=NSApplication.shared;app.setActivationPolicy(.regular)
let screen=NSScreen.screens[0].frame
precondition(screen.width>=1000 && screen.height>=700,"Need a visible GUI desktop")
let win=NSWindow(contentRect:NSRect(x:screen.maxX-310,y:screen.minY+70,width:290,height:180),styleMask:[.titled],backing:.buffered,defer:false)
win.title="Native file receiver";win.level = .floating
let view=ReceiverView(frame:NSRect(x:0,y:0,width:290,height:180));view.registerForDraggedTypes([.fileURL]);win.contentView=view
win.orderFrontRegardless()
DispatchQueue.main.asyncAfter(deadline:.now()+0.5) {
    let p=win.convertPoint(toScreen:NSPoint(x:145,y:90))
    save("receiver-ready.json",["pid":ProcessInfo.processInfo.processIdentifier,"x":p.x,"y":screen.maxY-p.y,"screenWidth":screen.width,"screenHeight":screen.height])
}
app.run()
