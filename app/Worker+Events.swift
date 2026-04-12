import Foundation
import SwiftUI
import BareRPC

extension Worker {

    func handleEvent(_ event: IncomingEvent) {
        guard let raw  = event.data,
              let dict = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
        else {
            print("[worker] event \(event.command) has no parseable data")
            return
        }

        print("[worker] event \(event.command): \(dict)")

        switch event.command {

        case Cmd.ready:
            let rawSpaces = dict["spaces"] as? [[String: Any]] ?? []
            let loaded    = rawSpaces.map { Space(from: $0) }
            DispatchQueue.main.async {
                self.spaces = loaded
                self.ready  = true
                print("[worker] ready — loaded \(loaded.count) spaces")
            }

        case Cmd.spaceChanged:
            guard let spaceId = dict["spaceId"] as? String,
                  let key     = dict["key"]     as? String,
                  let type    = dict["type"]    as? String
            else { return }
            DispatchQueue.main.async {
                self.recentChanges.insert((spaceId: spaceId, key: key, type: type), at: 0)
                if self.recentChanges.count > 20 {
                    self.recentChanges = Array(self.recentChanges.prefix(20))
                }
            }

        case Cmd.peerConnected:
            guard let spaceId = dict["spaceId"] as? String,
                  let peers   = dict["peers"]   as? Int
            else { return }
            DispatchQueue.main.async {
                if let i = self.spaces.firstIndex(where: { $0.id == spaceId }) {
                    self.spaces[i].peers = peers
                }
            }

        case Cmd.peerDisconnected:
            guard let spaceId = dict["spaceId"] as? String,
                  let peers   = dict["peers"]   as? Int
            else { return }
            DispatchQueue.main.async {
                if let i = self.spaces.firstIndex(where: { $0.id == spaceId }) {
                    self.spaces[i].peers = peers
                }
            }

        case Cmd.error:
            print("[worker] js error: \(dict["message"] ?? "unknown")")

        default:
            print("[worker] unhandled event: \(event.command)")
        }
    }
}
