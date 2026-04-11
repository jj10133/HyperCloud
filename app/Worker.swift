import Foundation
import SwiftUI

final class Worker: ObservableObject {

    // MARK: - Published state

    @Published var spaces:  [DriftSpace] = []
    @Published var ready:   Bool = false
    @Published var recentChanges: [(spaceId: String, key: String, type: String)] = []

    // MARK: - Internal

    let bridge = IPCBridge()

    // MARK: - Init

    init() {
        bridge.rpc.onEvent   = { [weak self] event in self?.handleEvent(event) }
        bridge.rpc.onRequest = { req in req.reply(nil) }
        bridge.rpc.onError   = { err in print("[drift] rpc error: \(err)") }
        Task { await bridge.start() }
    }

    // MARK: - Public API

    func createSpace(name: String) {
        Task {
            _ = try? await bridge.request(Cmd.createSpace, body: ["name": name])
        }
    }

    func joinSpace(name: String, key: String) {
        Task {
            _ = try? await bridge.request(Cmd.joinSpace, body: ["name": name, "key": key])
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