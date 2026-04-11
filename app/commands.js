//
//  command.js
//  App
//
//  Created by Janardhan on 2026-04-11.
//

'use strict'

// Swift → JS requests
const CMD_GET_SPACES        = 1
const CMD_CREATE_SPACE      = 2
const CMD_JOIN_SPACE        = 3
const CMD_DELETE_SPACE      = 4
const CMD_GET_SPACE_KEY     = 5
const CMD_OPEN_FOLDER       = 6
const CMD_PAUSE_SPACE       = 7
const CMD_RESUME_SPACE      = 8

// JS → Swift events (unprompted pushes)
const CMD_READY             = 20
const CMD_SPACE_CHANGED     = 21
const CMD_PEER_CONNECTED    = 22
const CMD_PEER_DISCONNECTED = 23
const CMD_SYNC_STATUS       = 24
const CMD_ERROR             = 25

module.exports = {
  CMD_GET_SPACES,
  CMD_CREATE_SPACE,
  CMD_JOIN_SPACE,
  CMD_DELETE_SPACE,
  CMD_GET_SPACE_KEY,
  CMD_OPEN_FOLDER,
  CMD_PAUSE_SPACE,
  CMD_RESUME_SPACE,
  CMD_READY,
  CMD_SPACE_CHANGED,
  CMD_PEER_CONNECTED,
  CMD_PEER_DISCONNECTED,
  CMD_SYNC_STATUS,
  CMD_ERROR
}
