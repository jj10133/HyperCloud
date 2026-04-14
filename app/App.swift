import BareKit
import SwiftUI

@main
struct App: SwiftUI.App {
    
    @StateObject private var worker = Worker()
    @Environment(\.scenePhase) private var scenePhase
    
    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(worker)
        } label: {
            Label("HyperCloud", systemImage: worker.ready ? "externaldrive.fill.badge.icloud" : "clock")
        }
        .menuBarExtraStyle(.window)
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .background: worker.suspend()
            case .active:     worker.resume()
            default: break
            }
        }
    }
}
