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
    this.spaces = new Map()
    this.swarm  = null
    this.rpc    = new RPC(BareKit.IPC, (req) => this._onRequest(req))

    this._init()
  }

  async _init () {
    console.log('[drift] init')
    store.init()

    this.swarm = new Hyperswarm()

    this.swarm.on('connection', (conn, info) => {
      console.log('[drift] connection', info.publicKey.toString('hex').slice(0, 8))

      // one mux per connection — all spaces share it
      const mux = new Protomux(conn)

      conn.on('error', (err) => console.log('[drift] conn error:', err.message))

      // attach every space to this mux
      // protomux matches channels by protocol+id so only shared spaces open
      for (const space of this.spaces.values()) {
        space.attachMux(mux, info)
      }
    })

    // register all spaces before joining swarm
    const saved = store.loadSpaces()
    console.log('[drift] loading', saved.length, 'saved spaces')
    for (const opts of saved) this._registerSpace(opts)

    // join all topics at once
    const flushes = []
    for (const space of this.spaces.values()) {
      const d = this.swarm.join(space.topic(), { server: true, client: true })
      flushes.push(d.flushed())
      space.startWatching()
    }
    await Promise.all(flushes)
    console.log('[drift] all spaces joined swarm')

    await new Promise(resolve => setTimeout(resolve, 500))
    this._emit(CMD_READY, { spaces: this._spacesJSON() })
  }

  _registerSpace (opts) {
    console.log('[drift] registering space:', opts.name)
    const space = new Space(opts, (event, data) => this._onSpaceEvent(event, data))
    this.spaces.set(space.id, space)
    return space
  }

  async _loadSpace (opts) {
    const space = this._registerSpace(opts)
    const d = this.swarm.join(space.topic(), { server: true, client: true })
    await d.flushed()
    space.startWatching()
    return space
  }

  async _createSpace (name) {
    const key  = crypto.randomBytes(32)
    const id   = crypto.randomBytes(16).toString('hex')
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
    this.spaces.delete(id)
    await space.destroy()
    store.removeSpace(id)
  }

  _onSpaceEvent (event, data) {
    if (event === 'space:changed')          this._emit(CMD_SPACE_CHANGED, data)
    else if (event === 'peer:connected')    this._emit(CMD_PEER_CONNECTED, data)
    else if (event === 'peer:disconnected') this._emit(CMD_PEER_DISCONNECTED, data)
  }

  _onRequest (req) {
    if (req.command === undefined) return
    console.log('[drift] request:', req.command)

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
