'use strict'

const Localdrive = require('localdrive')
const Localwatch = require('localwatch')
const RPC        = require('bare-rpc')
const crypto     = require('hypercore-crypto')
const fs         = require('bare-fs')
const path       = require('bare-path')
const store      = require('./store')

// ── commands over peer RPC ────────────────────────────────────────────────────
const PEER_MANIFEST = 1  // request: send me your file list
const PEER_GET      = 2  // request: send me this file's bytes
const PEER_PUT      = 3  // event:   I changed this file
const PEER_DEL      = 4  // event:   I deleted this file

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
    this._watch  = null
    this._peers  = new Map() // id → { conn, rpc }
  }

  // ── Topic ─────────────────────────────────────────────────────────────────

  topic () {
    return this._topic
  }

  // ── Peers ─────────────────────────────────────────────────────────────────

  addPeer (conn, info) {
    const id = info.publicKey.toString('hex')
    if (this._peers.has(id)) return

    // open bare-rpc directly on the hyperswarm stream
    const rpc = new RPC(conn, (req) => this._onPeerRequest(req))

    rpc.on('close', () => {
      this._peers.delete(id)
      this._emit('peer:disconnected', {
        spaceId: this.id,
        peerId:  id,
        peers:   this._peers.size
      })
    })

    conn.on('error', () => {})

    this._peers.set(id, { conn, rpc })

    this._emit('peer:connected', {
      spaceId: this.id,
      peerId:  id,
      peers:   this._peers.size
    })

    // sync with this peer immediately
    this._syncWithPeer(id)
  }

  peerCount () {
    return this._peers.size
  }

  // ── Peer RPC handlers (incoming from remote peer) ─────────────────────────

  async _onPeerRequest (req) {
    switch (req.command) {

      case PEER_MANIFEST: {
        // peer wants our file list
        const manifest = await this._buildManifest()
        req.reply(Buffer.from(JSON.stringify(manifest)))
        break
      }

      case PEER_GET: {
        // peer wants a specific file
        const key  = req.data.toString()
        const abs  = path.join(this._folder, key)
        try {
          const data = await fs.promises.readFile(abs)
          req.reply(data)
        } catch {
          req.reply(Buffer.alloc(0))
        }
        break
      }

      case PEER_PUT: {
        // peer pushed a file change to us
        const { key, data: b64 } = JSON.parse(req.data.toString())
        const data = Buffer.from(b64, 'base64')
        const abs  = path.join(this._folder, key)
        try {
          await fs.promises.mkdir(path.dirname(abs), { recursive: true })
          await fs.promises.writeFile(abs, data)
          this._emit('space:changed', {
            spaceId: this.id, type: 'update', key, peers: this._peers.size
          })
        } catch {}
        req.reply(Buffer.alloc(0))
        break
      }

      case PEER_DEL: {
        // peer deleted a file
        const key = req.data.toString()
        const abs = path.join(this._folder, key)
        try {
          await fs.promises.unlink(abs)
          this._emit('space:changed', {
            spaceId: this.id, type: 'delete', key, peers: this._peers.size
          })
        } catch {}
        req.reply(Buffer.alloc(0))
        break
      }

      default:
        req.reply(Buffer.alloc(0))
    }
  }

  // ── Initial sync with a peer ──────────────────────────────────────────────

  async _syncWithPeer (peerId) {
    const peer = this._peers.get(peerId)
    if (!peer) return

    try {
      // get their manifest
      const raw          = await peer.rpc.request(PEER_MANIFEST, Buffer.alloc(0))
      const theirFiles   = JSON.parse(raw.toString()) // [{ key, mtime, hash }]
      const myManifest   = await this._buildManifest()
      const myMap        = new Map(myManifest.map(f => [f.key, f]))

      for (const their of theirFiles) {
        const mine = myMap.get(their.key)

        // pull if we don't have it or theirs is newer
        if (!mine || their.mtime > mine.mtime) {
          const data = await peer.rpc.request(
            PEER_GET,
            Buffer.from(their.key)
          )
          if (data && data.length > 0) {
            const abs = path.join(this._folder, their.key)
            await fs.promises.mkdir(path.dirname(abs), { recursive: true })
            await fs.promises.writeFile(abs, data)
          }
        }
      }
    } catch {
      // peer disconnected mid-sync, fine
    }
  }

  // ── Manifest builder ──────────────────────────────────────────────────────

  async _buildManifest () {
    const files = []
    try {
      for await (const entry of this._local.list('/')) {
        const abs  = path.join(this._folder, entry.key)
        try {
          const stat = await fs.promises.stat(abs)
          files.push({
            key:   entry.key,
            mtime: stat.mtimeMs,
            hash:  entry.value?.blob?.hash?.toString('hex') || ''
          })
        } catch {}
      }
    } catch {}
    return files
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

            // push to all connected peers
            for (const [, peer] of this._peers) {
              try {
                await peer.rpc.request(PEER_PUT, Buffer.from(
                  JSON.stringify({ key, data: data.toString('base64') })
                ))
              } catch {}
            }

          } else if (type === 'delete') {
            for (const [, peer] of this._peers) {
              try {
                await peer.rpc.request(PEER_DEL, Buffer.from(key))
              } catch {}
            }
          }

          this._emit('space:changed', {
            spaceId: this.id,
            type,
            key,
            peers: this._peers.size
          })

        } catch {}
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
    for (const [, peer] of this._peers) {
      try { peer.rpc.destroy() } catch {}
    }
    this._peers.clear()
  }
}

module.exports = Space
