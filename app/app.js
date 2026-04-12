'use strict'

const Hyperswarm = require('hyperswarm')
const crypto     = require('hypercore-crypto')
const { spawn }  = require('bare-subprocess')
const RPC        = require('bare-rpc')

const store    = require('./store')
const Space    = require('./space')
const commands = require('./commands')

const {
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
  CMD_ERROR
} = commands

class Drift {
  constructor () {
    this.spaces = new Map()  // id → Space
    this._topics = new Map() // topicHex → Space
    this.swarm  = null
    this.rpc    = new RPC(BareKit.IPC, (req) => this._onRequest(req))

    this._init()
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  async _init () {
    store.init()

    this.swarm = new Hyperswarm()
    this.swarm.on('connection', (conn, info) => this._onConnection(conn, info))

    for (const saved of store.loadSpaces()) {
      await this._loadSpace(saved)
    }

    this._emit(CMD_READY, { spaces: this._spacesJSON() })
  }

  // ── Connection routing ────────────────────────────────────────────────────

  _onConnection (conn, info) {
    // try info.topics first (initiator side always has this)
    if (info.topics && info.topics.length > 0) {
      for (const t of info.topics) {
        const space = this._topics.get(t.toString('hex'))
        if (space) { space.addPeer(conn, info); return }
      }
    }

    // responder side — info.topics may be empty
    // match by checking which topic this peer's key is associated with
    // Hyperswarm exposes the topic via the discovery key on the peer info
    if (info.discoveryKey) {
      const space = this._topics.get(info.discoveryKey.toString('hex'))
      if (space) { space.addPeer(conn, info); return }
    }

    // last resort — if only one space exists, assign to it
    if (this.spaces.size === 1) {
      const space = [...this.spaces.values()][0]
      space.addPeer(conn, info)
    }
  }

  // ── Space lifecycle ───────────────────────────────────────────────────────

  async _loadSpace (opts) {
    const space = new Space(opts, (event, data) => this._onSpaceEvent(event, data))
    this.spaces.set(space.id, space)
    this._topics.set(space.topic().toString('hex'), space)

    const discovery = this.swarm.join(space.topic(), { server: true, client: true })
    await discovery.flushed()

    space.startWatching()
    return space
  }

  async _createSpace (name) {
    const key = crypto.randomBytes(32)
    const id  = crypto.randomBytes(16).toString('hex')
    const opts = { id, name, key: key.toString('hex'), paused: false }

    store.addSpace(opts)
    return this._loadSpace(opts)
  }

  async _joinSpace (name, keyHex) {
    const id   = crypto.randomBytes(16).toString('hex')
    const opts = { id, name, key: keyHex, paused: false }

    store.addSpace(opts)
    return this._loadSpace(opts)
  }

  async _deleteSpace (id) {
    const space = this.spaces.get(id)
    if (!space) return

    this._topics.delete(space.topic().toString('hex'))
    this.spaces.delete(id)
    await space.destroy()
    store.removeSpace(id)
  }

  // ── Space events → Swift ──────────────────────────────────────────────────

  _onSpaceEvent (event, data) {
    if (event === 'space:changed')      this._emit(CMD_SPACE_CHANGED, data)
    else if (event === 'peer:connected')    this._emit(CMD_PEER_CONNECTED, data)
    else if (event === 'peer:disconnected') this._emit(CMD_PEER_DISCONNECTED, data)
  }

  // ── Swift → JS requests ───────────────────────────────────────────────────

  _onRequest (req) {
    if (req.command === undefined) return

    const body  = req.data ? JSON.parse(req.data.toString()) : {}
    const reply = (err, data) => {
      if (err) return req.reply(Buffer.from(JSON.stringify({ error: err.message })))
      req.reply(Buffer.from(JSON.stringify(data || {})))
    }

    switch (req.command) {
      case CMD_GET_SPACES:
        return reply(null, { spaces: this._spacesJSON() })

      case CMD_CREATE_SPACE:
        return this._createSpace(body.name)
          .then(space => reply(null, space.toJSON()))
          .catch(err  => reply(err))

      case CMD_JOIN_SPACE:
        return this._joinSpace(body.name, body.key)
          .then(space => reply(null, space.toJSON()))
          .catch(err  => reply(err))

      case CMD_DELETE_SPACE:
        return this._deleteSpace(body.id)
          .then(() => reply(null))
          .catch(err => reply(err))

      case CMD_GET_SPACE_KEY: {
        const space = this.spaces.get(body.id)
        if (!space) return reply(new Error('space not found'))
        return reply(null, { key: space.key.toString('hex') })
      }

      case CMD_OPEN_FOLDER: {
        const space = this.spaces.get(body.id)
        if (!space) return reply(new Error('space not found'))
        spawn('open', [space._folder], { detached: true })
        return reply(null)
      }

      case CMD_PAUSE_SPACE: {
        const space = this.spaces.get(body.id)
        if (!space) return reply(new Error('space not found'))
        space.pause()
        store.saveSpaces([...this.spaces.values()].map(s => s.toJSON()))
        return reply(null)
      }

      case CMD_RESUME_SPACE: {
        const space = this.spaces.get(body.id)
        if (!space) return reply(new Error('space not found'))
        space.resume()
        store.saveSpaces([...this.spaces.values()].map(s => s.toJSON()))
        return reply(null)
      }

      default:
        return reply(new Error('unknown command'))
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _emit (command, data) {
    const payload = data ? Buffer.from(JSON.stringify(data)) : Buffer.alloc(0)
    this.rpc.event(command, payload)
  }

  _spacesJSON () {
    return [...this.spaces.values()].map(s => s.toJSON())
  }
}

new Drift()
