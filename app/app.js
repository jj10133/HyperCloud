'use strict'

const Hyperswarm = require('hyperswarm')
const crypto     = require('hypercore-crypto')
const { spawn }   = require('bare-subprocess')
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
    // spaceId → Space
    this.spaces = new Map()
    this.swarm  = null
    this.rpc    = new RPC(BareKit.IPC, (req) => this._onRequest(req))

    this._init()
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  async _init () {
    store.init()

    this.swarm = new Hyperswarm()
    this.swarm.on('connection', (conn, info) => this._onConnection(conn, info))

    // restore persisted spaces
    for (const saved of store.loadSpaces()) {
      await this._loadSpace(saved)
    }

    this._emit(CMD_READY, {
      spaces: this._spacesJSON()
    })
  }

  // ── Connection routing ────────────────────────────────────────────────────

  _onConnection (conn, info) {
    // figure out which space this connection belongs to
    // by matching the swarm topic
    const topic = info.topics && info.topics[0]
    if (!topic) return

    const topicHex = topic.toString('hex')
    const space = this._spaceByTopic(topicHex)
    if (!space) return

    space.addPeer(conn, info)
  }

  _spaceByTopic (topicHex) {
    for (const space of this.spaces.values()) {
      if (space.topic().toString('hex') === topicHex) return space
    }
    return null
  }

  // ── Space lifecycle ───────────────────────────────────────────────────────

  async _loadSpace (opts) {
    const space = new Space(opts, (event, data) => this._onSpaceEvent(event, data))
    this.spaces.set(space.id, space)

    this.swarm.join(space.topic(), { server: true, client: true })
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

    await space.destroy()
    this.spaces.delete(id)
    store.removeSpace(id)
  }

  // ── Space events → Swift ──────────────────────────────────────────────────

  _onSpaceEvent (event, data) {
    if (event === 'space:changed') {
      this._emit(CMD_SPACE_CHANGED, data)
    } else if (event === 'peer:connected') {
      this._emit(CMD_PEER_CONNECTED, data)
    } else if (event === 'peer:disconnected') {
      this._emit(CMD_PEER_DISCONNECTED, data)
    }
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

      case CMD_GET_SPACE_KEY:
        const space = this.spaces.get(body.id)
        if (!space) return reply(new Error('space not found'))
        return reply(null, { key: space.key.toString('hex') })

      case CMD_OPEN_FOLDER:
        const s = this.spaces.get(body.id)
        if (!s) return reply(new Error('space not found'))
        spawn('open', [s._folder], { detached: true })
        return reply(null)

      case CMD_PAUSE_SPACE:
        const ps = this.spaces.get(body.id)
        if (!ps) return reply(new Error('space not found'))
        ps.pause()
        store.saveSpaces([...this.spaces.values()].map(s => s.toJSON()))
        return reply(null)

      case CMD_RESUME_SPACE:
        const rs = this.spaces.get(body.id)
        if (!rs) return reply(new Error('space not found'))
        rs.resume()
        store.saveSpaces([...this.spaces.values()].map(s => s.toJSON()))
        return reply(null)

      default:
        return reply(new Error('unknown command'))
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _emit (command, data) {
    const payload = data ? Buffer.from(JSON.stringify(data)) : Buffer.alloc(0)
    this.rpc.event(command).send(payload)
  }

  _spacesJSON () {
    return [...this.spaces.values()].map(s => s.toJSON())
  }
}

// boot
new Drift()
