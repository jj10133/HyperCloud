import Foundation
import SwiftUI

final class Worker: ObservableObject {

    // MARK: - Published state

    @Published var spaces:        [DriftSpace] = []
    @Published var ready:         Bool = false
    @Published var recentChanges: [(spaceId: String, key: String, type: String)] = []

    // MARK: - Internal

    let bridge = IPCBridge()

    // MARK: - Init

    init() {
        print("[worker] init")
        bridge.onEvent   = { [weak self] event in
            print("[worker] bridge.onEvent fired command: \(event.command)")
            self?.handleEvent(event)
        }
        bridge.onRequest = { req in
            print("[worker] bridge.onRequest — unexpected request from JS command: \(req.command)")
            req.reply(nil)
        }
        bridge.onError = { err in
            print("[worker] bridge.onError: \(err)")
        }
        Task {
            print("[worker] starting bridge")
            await bridge.start()
            print("[worker] bridge ended")
        }
    }

    // MARK: - Public API

    func createSpace(name: String) {
        print("[worker] createSpace: \(name)")
        Task {
            do {
                let res = try await bridge.request(Cmd.createSpace, body: ["name": name])
                print("[worker] createSpace response: \(String(describing: res))")
                if let res, let space = res["error"] as? String {
                    print("[worker] createSpace error from JS: \(space)")
                    return
                }
                if let res {
                    let space = DriftSpace(from: res)
                    await MainActor.run {
                        self.spaces.append(space)
                        print("[worker] appended space, total: \(self.spaces.count)")
                    }
                }
            } catch {
                print("[worker] createSpace threw: \(error)")
            }
        }
    }

    func joinSpace(name: String, key: String) {
        print("[worker] joinSpace: \(name)")
        Task {
            do {
                let res = try await bridge.request(Cmd.joinSpace, body: ["name": name, "key": key])
                print("[worker] joinSpace response: \(String(describing: res))")
                if let res {
                    let space = DriftSpace(from: res)
                    await MainActor.run {
                        self.spaces.append(space)
                        print("[worker] joined space appended, total: \(self.spaces.count)")
                    }
                }
            } catch {
                print("[worker] joinSpace threw: \(error)")
            }
        }
    }

    func deleteSpace(id: String) {
        print("[worker] deleteSpace: \(id)")
        Task {
            do {
                _ = try await bridge.request(Cmd.deleteSpace, body: ["id": id])
                await MainActor.run {
                    self.spaces.removeAll { $0.id == id }
                    print("[worker] deleted space, remaining: \(self.spaces.count)")
                }
            } catch {
                print("[worker] deleteSpace threw: \(error)")
            }
        }
    }

    func openFolder(id: String) {
        print("[worker] openFolder: \(id)")
        Task {
            do {
                _ = try await bridge.request(Cmd.openFolder, body: ["id": id])
            } catch {
                print("[worker] openFolder threw: \(error)")
            }
        }
    }

    func pauseSpace(id: String) {
        print("[worker] pauseSpace: \(id)")
        Task {
            do {
                _ = try await bridge.request(Cmd.pauseSpace, body: ["id": id])
                await MainActor.run {
                    if let i = self.spaces.firstIndex(where: { $0.id == id }) {
                        self.spaces[i].paused = true
                    }
                }
            } catch {
                print("[worker] pauseSpace threw: \(error)")
            }
        }
    }

    func resumeSpace(id: String) {
        print("[worker] resumeSpace: \(id)")
        Task {
            do {
                _ = try await bridge.request(Cmd.resumeSpace, body: ["id": id])
                await MainActor.run {
                    if let i = self.spaces.firstIndex(where: { $0.id == id }) {
                        self.spaces[i].paused = false
                    }
                }
            } catch {
                print("[worker] resumeSpace threw: \(error)")
            }
        }
    }

    func getSpaceKey(id: String) async -> String? {
        print("[worker] getSpaceKey: \(id)")
        do {
            let res = try await bridge.request(Cmd.getSpaceKey, body: ["id": id])
            print("[worker] getSpaceKey response: \(String(describing: res))")
            return res?["key"] as? String
        } catch {
            print("[worker] getSpaceKey threw: \(error)")
            return nil
        }
    }

    // MARK: - Lifecycle

    func suspend()   { print("[worker] suspend"); bridge.suspend() }
    func resume()    { print("[worker] resume");  bridge.resume() }
    func terminate() { print("[worker] terminate"); bridge.terminate() }
}
