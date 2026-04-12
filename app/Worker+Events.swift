import Foundation
import SwiftUI

extension Worker {

    func handleEvent(_ event: IncomingEvent) {
        print("[worker] received event command: \(event.command)")

        guard let raw = event.data else {
            print("[worker] event has no data")
            return
        }

        print("[worker] raw data: \(String(data: raw, encoding: .utf8) ?? "not utf8")")

        guard let dict = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
            print("[worker] failed to parse event data as JSON")
            return
        }

        switch event.command {

        case Cmd.ready:
            print("[worker] CMD_READY received")
            let rawSpaces = dict["spaces"] as? [[String: Any]] ?? []
            print("[worker] spaces in payload: \(rawSpaces.count)")
            for s in rawSpaces { print("[worker]   space: \(s["name"] ?? "?") id: \(s["id"] ?? "?")") }
            let loaded = rawSpaces.map { DriftSpace(from: $0) }
            DispatchQueue.main.async {
                self.spaces = loaded
                self.ready  = true
                print("[worker] spaces set on main thread: \(self.spaces.count)")
            }

        case Cmd.spaceChanged:
            print("[worker] CMD_SPACE_CHANGED: \(dict)")
            guard let spaceId = dict["spaceId"] as? String,
                  let key     = dict["key"]     as? String,
                  let type    = dict["type"]    as? String
            else {
                print("[worker] spaceChanged missing fields")
                return
            }
            DispatchQueue.main.async {
                self.recentChanges.insert(
                    (spaceId: spaceId, key: key, type: type),
                    at: 0
                )
                if self.recentChanges.count > 20 {
                    self.recentChanges = Array(self.recentChanges.prefix(20))
                }
            }

        case Cmd.peerConnected:
            print("[worker] CMD_PEER_CONNECTED: \(dict)")
            guard let spaceId = dict["spaceId"] as? String,
                  let peers   = dict["peers"]   as? Int
            else {
                print("[worker] peerConnected missing fields")
                return
            }
            DispatchQueue.main.async {
                if let i = self.spaces.firstIndex(where: { $0.id == spaceId }) {
                    self.spaces[i].peers = peers
                    print("[worker] updated space \(spaceId) peers to \(peers)")
                } else {
                    print("[worker] peerConnected — space not found: \(spaceId)")
                }
            }

        case Cmd.peerDisconnected:
            print("[worker] CMD_PEER_DISCONNECTED: \(dict)")
            guard let spaceId = dict["spaceId"] as? String,
                  let peers   = dict["peers"]   as? Int
            else { return }
            DispatchQueue.main.async {
                if let i = self.spaces.firstIndex(where: { $0.id == spaceId }) {
                    self.spaces[i].peers = peers
                }
            }

        case Cmd.error:
            let msg = dict["message"] as? String ?? "unknown error"
            print("[worker] CMD_ERROR from JS: \(msg)")

        default:
            print("[worker] unhandled event command: \(event.command)")
        }
    }
}
