'use strict'

const Hyperswarm = require('hyperswarm')
const Protomux   = require('protomux')
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
  CMD_PEER_DISCONNECTED
} = commands

class Drift {
  constructor () {
    this.spaces  = new Map()
    this._topics = new Map()
    this.swarm   = null
    this.rpc     = new RPC(BareKit.IPC, (req) => this._onRequest(req))

    this._init()
  }

  async _init () {
    console.log('[drift] init')
    store.init()

    this.swarm = new Hyperswarm()

    this.swarm.on('connection', (conn, info) => {
      const noiseKey   = info.publicKey.toString('hex')
      const topicHexes = (info.topics || []).map(t => t.toString('hex'))
      console.log('[drift] connection noise:', noiseKey.slice(0, 8), 'topics:', topicHexes.map(t => t.slice(0, 8)))

      const mux = new Protomux(conn)
      conn.on('error', (err) => console.log('[drift] conn error:', err.message))

      // find matching spaces
      const matched = []

      if (topicHexes.length > 0) {
        for (const hex of topicHexes) {
          const space = this._topics.get(hex)
          if (space) matched.push(space)
        }
      }

      if (matched.length === 0) {
        // responder side has no topics — give mux to ALL spaces
        // protomux-rpc will only open channels that the remote also opens
        console.log('[drift] no topics — giving mux to all spaces')
        for (const space of this.spaces.values()) matched.push(space)
      }

      console.log('[drift] matched spaces:', matched.map(s => s.name))
      for (const space of matched) space.addPeer(mux, info)
    })

    // load all spaces first WITHOUT joining swarm
    const saved = store.loadSpaces()
    console.log('[drift] loading', saved.length, 'saved spaces')
    for (const opts of saved) this._registerSpace(opts)

    // now join swarm for all spaces at once
    const discoveries = []
    for (const space of this.spaces.values()) {
      const d = this.swarm.join(space.topic(), { server: true, client: true })
      discoveries.push(d.flushed())
      space.startWatching()
    }

    await Promise.all(discoveries)
    console.log('[drift] all spaces joined swarm')

    await new Promise(resolve => setTimeout(resolve, 500))

    const spacesJSON = this._spacesJSON()
    console.log('[drift] ready, spaces:', spacesJSON.length)
    this._emit(CMD_READY, { spaces: spacesJSON })
  }

  // register space in memory only — no swarm join yet
  _registerSpace (opts) {
    console.log('[drift] registering space:', opts.name)
    const space = new Space(opts, (event, data) => this._onSpaceEvent(event, data))
    this.spaces.set(space.id, space)
    this._topics.set(space.topic().toString('hex'), space)
    console.log('[drift] registered topic', space.topic().toString('hex').slice(0, 8), 'for', opts.name)
    return space
  }

  // register + join swarm + watch — for newly created/joined spaces
  async _loadSpace (opts) {
    const space = this._registerSpace(opts)
    const discovery = this.swarm.join(space.topic(), { server: true, client: true })
    await discovery.flushed()
    console.log('[drift] swarm joined for', opts.name)
    space.startWatching()
    return space
  }

  async _createSpace (name) {
    console.log('[drift] creating space:', name)
    const key  = crypto.randomBytes(32)
    const id   = crypto.randomBytes(16).toString('hex')
    const opts = { id, name, key: key.toString('hex'), paused: false }
    store.addSpace(opts)
    return this._loadSpace(opts)
  }

  async _joinSpace (name, keyHex) {
    console.log('[drift] joining space:', name)
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

  _onSpaceEvent (event, data) {
    console.log('[drift] space event:', event)
    if (event === 'space:changed')          this._emit(CMD_SPACE_CHANGED, data)
    else if (event === 'peer:connected')    this._emit(CMD_PEER_CONNECTED, data)
    else if (event === 'peer:disconnected') this._emit(CMD_PEER_DISCONNECTED, data)
  }

  _onRequest (req) {
    if (req.command === undefined) return
    console.log('[drift] request command:', req.command)

    const body  = req.data ? JSON.parse(req.data.toString()) : {}
    const reply = (err, data) => {
      if (err) {
        console.log('[drift] reply error:', err.message)
        return req.reply(Buffer.from(JSON.stringify({ error: err.message })))
      }
      req.reply(Buffer.from(JSON.stringify(data || {})))
    }

    switch (req.command) {
      case CMD_GET_SPACES:
        return reply(null, { spaces: this._spacesJSON() })

      case CMD_CREATE_SPACE:
        return this._createSpace(body.name)
          .then(s  => reply(null, s.toJSON()))
          .catch(e => reply(e))

      case CMD_JOIN_SPACE:
        return this._joinSpace(body.name, body.key)
          .then(s  => reply(null, s.toJSON()))
          .catch(e => reply(e))

      case CMD_DELETE_SPACE:
        return this._deleteSpace(body.id)
          .then(() => reply(null))
          .catch(e  => reply(e))

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
        console.log('[drift] unknown command:', req.command)
        return reply(new Error('unknown command'))
    }
  }

  _emit (command, data) {
    const payload = data ? Buffer.from(JSON.stringify(data)) : Buffer.alloc(0)
    this.rpc.event(command, payload)
  }

  _spacesJSON () {
    return [...this.spaces.values()].map(s => s.toJSON())
  }
}

new Drift()
