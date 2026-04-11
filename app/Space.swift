//
//  HyperSpace.swift
//  App
//
//  Created by Janardhan on 2026-04-11.
//


import Foundation

struct Space: Identifiable, Codable {
    let id:     String
    var name:   String
    var folder: String
    var peers:  Int
    var paused: Bool

    // decoded from JS JSON
    init(from dict: [String: Any]) {
        id     = dict["id"]     as? String ?? UUID().uuidString
        name   = dict["name"]   as? String ?? "unnamed"
        folder = dict["folder"] as? String ?? ""
        peers  = dict["peers"]  as? Int    ?? 0
        paused = dict["paused"] as? Bool   ?? false
    }
}
