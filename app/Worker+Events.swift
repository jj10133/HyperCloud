import Foundation
import SwiftUI

extension Worker {

    func handleEvent(_ event: RPCEvent) {
        guard let raw  = event.data,
              let dict = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
        else { return }

        switch event.command {

        case Cmd.ready:
            let raw = dict["spaces"] as? [[String: Any]] ?? []
            let loaded = raw.map { DriftSpace(from: $0) }
            DispatchQueue.main.async {
                self.spaces = loaded
                self.ready  = true
            }

        case Cmd.spaceChanged:
            guard let spaceId = dict["spaceId"] as? String,
                  let key     = dict["key"]     as? String,
                  let type    = dict["type"]    as? String
            else { return }

            DispatchQueue.main.async {
                self.recentChanges.insert(
                    (spaceId: spaceId, key: key, type: type),
                    at: 0
                )
                // keep last 20
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
            let msg = dict["message"] as? String ?? "unknown error"
            print("[drift] js error: \(msg)")

        default:
            break
        }
    }
}