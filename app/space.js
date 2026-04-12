'use strict'

const Localdrive       = require('localdrive')
const DistributedDrive = require('distributed-drive')
const Localwatch       = require('localwatch')
const Protomux         = require('protomux')
const crypto           = require('hypercore-crypto')
const fs               = require('bare-fs')
const path             = require('bare-path')
const store            = require('./store')

class Space {
  constructor (opts, emit) {
    this.id     = opts.id
    this.name   = opts.name
    this.key    = Buffer.from(opts.key, 'hex')
    this.paused = opts.paused || false

    this._emit   = emit
    this._folder = store.ensureSpaceFolder(this.name)
    this._topic  = crypto.hash(this.key)

    this._local  = new Localdrive(this._folder)
    this._drive  = new DistributedDrive(this._local)
    this._watch  = null
    this._peers  = new Map() // noiseKeyHex → conn
  }

  // ── Topic ─────────────────────────────────────────────────────────────────

  topic () {
    return this._topic
  }

  // ── Peers ─────────────────────────────────────────────────────────────────

  addPeer (conn, info) {
    const id = info.publicKey.toString('hex')
    if (this._peers.has(id)) return

    this._peers.set(id, conn)

    // hyperswarm gives a raw stream — protomux-rpc needs a Protomux instance
    const mux = new Protomux(conn)
    this._drive.addPeer(mux)

    conn.on('close', () => {
      this._peers.delete(id)
      this._emit('peer:disconnected', {
        spaceId: this.id,
        peerId:  id,
        peers:   this._peers.size
      })
    })

    conn.on('error', () => {}) // prevent unhandled crashes

    this._emit('peer:connected', {
      spaceId: this.id,
      peerId:  id,
      peers:   this._peers.size
    })

    // pull anything newer from the new peer
    this._initialSync()
  }

  peerCount () {
    return this._peers.size
  }

  // ── Initial sync ──────────────────────────────────────────────────────────

  async _initialSync () {
    try {
      for await (const { key, mtime } of this._drive.listAll('/')) {
        const localEntry = await this._local.entry(key)
        const localMtime = localEntry?.value?.metadata?.mtime || 0

        if (mtime > localMtime) {
          const data = await this._drive.get(key)
          if (data) {
            const dest = path.join(this._folder, key)
            await fs.promises.mkdir(path.dirname(dest), { recursive: true })
            await fs.promises.writeFile(dest, data)
          }
        }
      }
    } catch {
      // peer may disconnect mid-sync, that is fine
    }
  }

  // ── Watch ─────────────────────────────────────────────────────────────────

  startWatching () {
    if (this._watch || this.paused) return

    this._watch = new Localwatch(this._folder, {
      filter: (filename) => Localwatch.defaultFilter(filename)
    })

    this._consumeWatch()
  }

  async _consumeWatch () {
    for await (const diff of this._watch) {
      if (this.paused) continue

      for (const { type, filename } of diff) {
        const rel = path.relative(this._folder, filename)
        const key = '/' + rel.split(path.sep).join('/')

        try {
          if (type === 'update') {
            const data = await fs.promises.readFile(filename)
            await this._drive.put(key, data)
          } else if (type === 'delete') {
            await this._drive.del(key)
          }

          this._emit('space:changed', {
            spaceId: this.id,
            type,
            key,
            peers:   this._peers.size
          })
        } catch {
          // ignore transient errors
        }
      }
    }
  }

  stopWatching () {
    if (this._watch) {
      this._watch.destroy()
      this._watch = null
    }
  }

  // ── Pause / resume ────────────────────────────────────────────────────────

  pause () {
    this.paused = true
    this.stopWatching()
  }

  resume () {
    this.paused = false
    this.startWatching()
  }

  // ── Info ──────────────────────────────────────────────────────────────────

  toJSON () {
    return {
      id:     this.id,
      name:   this.name,
      key:    this.key.toString('hex'),
      folder: this._folder,
      peers:  this._peers.size,
      paused: this.paused
    }
  }

  async destroy () {
    this.stopWatching()
    this._peers.clear()
    await this._drive.close()
  }
}

module.exports = Space
