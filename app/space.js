'use strict'

const Localdrive = require('localdrive')
const watchDrive = require('watch-drive')
const Protomux   = require('protomux')
const c          = require('compact-encoding')
const crypto     = require('hypercore-crypto')
const store      = require('./store')

const jsonEnc = {
  preencode (state, v) { c.string.preencode(state, JSON.stringify(v)) },
  encode    (state, v) { c.string.encode(state, JSON.stringify(v)) },
  decode    (state)    { return JSON.parse(c.string.decode(state)) }
}

function hashBuf (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

class Space {
  constructor (opts, emit) {
    this.id     = opts.id
    this.name   = opts.name
    this.key    = Buffer.from(opts.key, 'hex')
    this.paused = opts.paused || false

    this._emit         = emit
    this._folder       = store.ensureSpaceFolder(this.name)
    this._topic        = crypto.hash(this.key)
    this._local        = new Localdrive(this._folder)
    this._watch        = null
    this._peers        = new Map()
    this._receivedHash = new Map() // key → sha256 of last peer-written content

    console.log('[space] created:', this.name, 'folder:', this._folder)
  }

  topic () { return this._topic }

  attachMux (mux, info) {
    const id     = info.publicKey.toString('hex')
    const peerId = id.slice(0, 8)

    if (this._peers.has(id)) return
    console.log('[space] attachMux', this.name, peerId)

    const self = this
    const msgs = {}

    const channel = mux.createChannel({
      protocol: 'drift/space',
      id:       this._topic,

      async onopen () {
        console.log('[space] channel open', self.name, peerId)
        self._peers.set(id, { channel, msgs })
        self._emit('peer:connected', {
          spaceId: self.id, peerId: id, peers: self._peers.size
        })

        const files = await self._buildManifest()
        console.log('[space] sending manifest', files.length, 'files to', peerId)
        msgs.manifest.send(files)
      },

      async onclose () {
        console.log('[space] channel close', self.name, peerId)
        self._peers.delete(id)
        self._emit('peer:disconnected', {
          spaceId: self.id, peerId: id, peers: self._peers.size
        })
      }
    })

    if (!channel) {
      console.log('[space] channel null', this.name, peerId)
      return
    }

    // msg 0: manifest
    msgs.manifest = channel.addMessage({
      encoding: jsonEnc,
      async onmessage (theirFiles) {
        console.log('[space] got manifest', theirFiles.length, 'files from', peerId)
        const myFiles = await self._buildManifest()
        const myMap   = new Map(myFiles.map(f => [f.key, f]))
        for (const their of theirFiles) {
          const mine = myMap.get(their.key)
          if (!mine || their.mtime > mine.mtime) {
            console.log('[space] want', their.key, 'from', peerId)
            msgs.want.send(their.key)
          }
        }
      }
    })

    // msg 1: file
    msgs.file = channel.addMessage({
      encoding: jsonEnc,
      async onmessage ({ key, data: b64 }) {
        const buf = Buffer.from(b64, 'base64')
        console.log('[space] recv file', key, buf.length, 'bytes from', peerId)

        // skip if content identical to what we already have
        const existing = await self._local.get(key)
        if (existing && existing.equals(buf)) {
          console.log('[space] skip (identical)', key)
          return
        }

        // store hash so watch-drive knows this write came from a peer
        self._receivedHash.set(key, hashBuf(buf))

        try {
          await self._local.put(key, buf)
          self._emit('space:changed', {
            spaceId: self.id, type: 'update', key, peers: self._peers.size
          })
        } catch (err) {
          console.log('[space] write failed', key, err.message)
          self._receivedHash.delete(key)
        }
      }
    })

    // msg 2: del
    msgs.del = channel.addMessage({
      encoding: c.string,
      async onmessage (key) {
        console.log('[space] recv del', key, 'from', peerId)
        self._receivedHash.set(key, '__deleted__')
        try {
          await self._local.del(key)
          self._emit('space:changed', {
            spaceId: self.id, type: 'delete', key, peers: self._peers.size
          })
        } catch (err) {
          console.log('[space] del failed', key, err.message)
          self._receivedHash.delete(key)
        }
      }
    })

    // msg 3: want
    msgs.want = channel.addMessage({
      encoding: c.string,
      async onmessage (key) {
        console.log('[space] peer wants', key)
        try {
          const buf = await self._local.get(key)
          if (buf) msgs.file.send({ key, data: buf.toString('base64') })
        } catch (err) {
          console.log('[space] want failed', key, err.message)
        }
      }
    })

    channel.open()
  }

  async _buildManifest () {
    const files = []
    try {
      for await (const entry of this._local.list('/')) {
        files.push({
          key:   entry.key,
          mtime: entry.mtime || 0,
          hash:  entry.value?.blob?.hash?.toString('hex') || ''
        })
      }
    } catch (err) {
      console.log('[space] manifest error:', err.message)
    }
    return files
  }

  startWatching () {
    if (this._watch || this.paused) return
    console.log('[space] watching', this._folder)
    this._watch = watchDrive(this._local)
    this._consumeWatch()
  }

  async _consumeWatch () {
    for await (const { diff } of this._watch) {
      if (this.paused) continue

      for (const { type, key } of diff) {
        // check if this change was caused by a peer write
        if (this._receivedHash.has(key)) {
          if (type === 'delete' && this._receivedHash.get(key) === '__deleted__') {
            // our own delete — skip
            this._receivedHash.delete(key)
            console.log('[space] skip (peer delete)', key)
            continue
          }

          if (type === 'update') {
            const buf  = await this._local.get(key)
            const hash = buf ? hashBuf(buf) : null
            if (hash && hash === this._receivedHash.get(key)) {
              // hash matches what we received — skip, it's our own write
              this._receivedHash.delete(key)
              console.log('[space] skip (peer write)', key)
              continue
            }
            // hash differs — user edited AFTER peer write, push it
            this._receivedHash.delete(key)
          }
        }

        console.log('[space] local change:', type, key, 'peers:', this._peers.size)

        try {
          if (type === 'update') {
            const buf = await this._local.get(key)
            if (!buf) continue
            for (const [, peer] of this._peers) {
              peer.msgs.file.send({ key, data: buf.toString('base64') })
            }
          } else if (type === 'delete') {
            for (const [, peer] of this._peers) {
              peer.msgs.del.send(key)
            }
          }

          this._emit('space:changed', {
            spaceId: this.id, type, key, peers: self._peers.size
          })
        } catch (err) {
          console.log('[space] watch error:', err.message)
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

  pause ()  { this.paused = true;  this.stopWatching() }
  resume () { this.paused = false; this.startWatching() }

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
      try { peer.channel.close() } catch {}
    }
    this._peers.clear()
  }
}

module.exports = Space
