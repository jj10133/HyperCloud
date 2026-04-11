import Foundation
import SwiftUI

final class Worker: ObservableObject {
    
    // MARK: - Published state
    
    @Published var spaces:  [Space] = []
    @Published var ready:   Bool = false
    @Published var recentChanges: [(spaceId: String, key: String, type: String)] = []
    
    // MARK: - Internal
    
    let bridge = IPCBridge()
    
    // MARK: - Init
    
    init() {
        bridge.onEvent   = { [weak self] event in self?.handleEvent(event) }
        bridge.onRequest = { req in req.reply(nil) }
        bridge.onError   = { err in print("[drift] rpc error: \(err)") }
        Task { await bridge.start() }
    }
    
    // MARK: - Public API
    
    func createSpace(name: String) {
        Task {
            guard let res = try? await bridge.request(Cmd.createSpace, body: ["name": name]) else { return }
            let space = Space(from: res)
            await MainActor.run { spaces.append(space) }
        }
    }
    
    func joinSpace(name: String, key: String) {
        Task {
            guard let res = try? await bridge.request(Cmd.joinSpace, body: ["name": name, "key": key]) else { return }
            let space = Space(from: res)
            await MainActor.run { spaces.append(space) }
        }
    }
    
    func deleteSpace(id: String) {
        Task {
            _ = try? await bridge.request(Cmd.deleteSpace, body: ["id": id])
            await MainActor.run { spaces.removeAll { $0.id == id } }
        }
    }
    
    func openFolder(id: String) {
        Task {
            _ = try? await bridge.request(Cmd.openFolder, body: ["id": id])
        }
    }
    
    func pauseSpace(id: String) {
        Task {
            _ = try? await bridge.request(Cmd.pauseSpace, body: ["id": id])
            await MainActor.run {
                if let i = spaces.firstIndex(where: { $0.id == id }) {
                    spaces[i].paused = true
                }
            }
        }
    }
    
    func resumeSpace(id: String) {
        Task {
            _ = try? await bridge.request(Cmd.resumeSpace, body: ["id": id])
            await MainActor.run {
                if let i = spaces.firstIndex(where: { $0.id == id }) {
                    spaces[i].paused = false
                }
            }
        }
    }
    
    func getSpaceKey(id: String) async -> String? {
        let res = try? await bridge.request(Cmd.getSpaceKey, body: ["id": id])
        return res?["key"] as? String
    }
    
    // MARK: - Lifecycle
    
    func suspend()   { bridge.suspend() }
    func resume()    { bridge.resume() }
    func terminate() { bridge.terminate() }
}
