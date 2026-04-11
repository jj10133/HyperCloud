//
//  Cmd.swift
//  App
//
//  Created by Janardhan on 2026-04-11.
//


import Foundation

// Must mirror commands.js exactly — same integer values.

enum Cmd {
    // Swift → JS requests
    static let getSpaces       = UInt(1)
    static let createSpace     = UInt(2)
    static let joinSpace       = UInt(3)
    static let deleteSpace     = UInt(4)
    static let getSpaceKey     = UInt(5)
    static let openFolder      = UInt(6)
    static let pauseSpace      = UInt(7)
    static let resumeSpace     = UInt(8)

    // JS → Swift events
    static let ready           = UInt(20)
    static let spaceChanged    = UInt(21)
    static let peerConnected   = UInt(22)
    static let peerDisconnected = UInt(23)
    static let syncStatus      = UInt(24)
    static let error           = UInt(25)
}