'use strict'

const Localdrive = require('localdrive')
const Localwatch = require('localwatch')
const Protomux   = require('protomux')
const c          = require('compact-encoding')
const crypto     = require('hypercore-crypto')
const fs         = require('bare-fs')
const path       = require('bare-path')
const store      = require('./store')

const jsonEnc = {
  preencode (state, v) { c.string.preencode(state, JSON.stringify(v)) },
  encode    (state, v) { c.string.encode(state, JSON.stringify(v)) },
  decode    (state)    { return JSON.parse(c.string.decode(state)) }
}

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
    this._peers  = new Map() // noiseKeyHex → { channel, msgs }

    console.log('[space] created:', this.name, 'folder:', this._folder)
  }

  topic () { return this._topic }

  attachMux (mux, info) {
    const id     = info.publicKey.toString('hex')
    const peerId = id.slice(0, 8)

    if (this._peers.has(id)) return
    console.log('[space] attachMux', this.name, peerId)

    const self = this

    // msgs object — populated after addMessage calls below
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

        // both sides send manifest on open
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

    // msg 0: manifest — [{ key, mtime, hash }]
    msgs.manifest = channel.addMessage({
      encoding: jsonEnc,
      async onmessage (theirFiles) {
        console.log('[space] got manifest', theirFiles.length, 'files from', peerId)
        const myFiles = await self._buildManifest()
        const myMap   = new Map(myFiles.map(f => [f.key, f]))

        for (const their of theirFiles) {
          const mine = myMap.get(their.key)
          if (!mine || their.mtime > mine.mtime) {
            // send a want for this file
            console.log('[space] want', their.key, 'from', peerId)
            msgs.want.send(their.key)
          }
        }
      }
    })

    // msg 1: file data — { key, data (base64) }
    msgs.file = channel.addMessage({
      encoding: jsonEnc,
      async onmessage ({ key, data: b64 }) {
        const buf = Buffer.from(b64, 'base64')
        const abs = path.join(self._folder, key)
        console.log('[space] recv file', key, buf.length, 'bytes from', peerId)
        try {
          await fs.promises.mkdir(path.dirname(abs), { recursive: true })
          await fs.promises.writeFile(abs, buf)
          self._emit('space:changed', {
            spaceId: self.id, type: 'update', key, peers: self._peers.size
          })
        } catch (err) {
          console.log('[space] write failed', key, err.message)
        }
      }
    })

    // msg 2: delete
    msgs.del = channel.addMessage({
      encoding: c.string,
      async onmessage (key) {
        const abs = path.join(self._folder, key)
        console.log('[space] recv del', key, 'from', peerId)
        try {
          await fs.promises.unlink(abs)
          self._emit('space:changed', {
            spaceId: self.id, type: 'delete', key, peers: self._peers.size
          })
        } catch (err) {
          console.log('[space] del failed', key, err.message)
        }
      }
    })

    // msg 3: want — peer requests a file by key
    msgs.want = channel.addMessage({
      encoding: c.string,
      async onmessage (key) {
        console.log('[space] peer wants', key, 'from', peerId)
        const abs = path.join(self._folder, key)
        try {
          const data = await fs.promises.readFile(abs)
          msgs.file.send({ key, data: data.toString('base64') })
          console.log('[space] sent', key, 'to', peerId)
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
        const abs = path.join(this._folder, entry.key)
        try {
          const stat = await fs.promises.stat(abs)
          files.push({
            key:   entry.key,
            mtime: stat.mtimeMs,
            hash:  entry.value?.blob?.hash?.toString('hex') || ''
          })
        } catch {}
      }
    } catch (err) {
      console.log('[space] manifest error:', err.message)
    }
    return files
  }

  startWatching () {
    if (this._watch || this.paused) return
    console.log('[space] watching', this._folder)
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
        console.log('[space] local change:', type, key, 'peers:', this._peers.size)

        try {
          if (type === 'update') {
            const data = await fs.promises.readFile(filename)
            for (const [, peer] of this._peers) {
              peer.msgs.file.send({ key, data: data.toString('base64') })
            }
          } else if (type === 'delete') {
            for (const [, peer] of this._peers) {
              peer.msgs.del.send(key)
            }
          }

          this._emit('space:changed', {
            spaceId: this.id, type, key, peers: this._peers.size
          })
        } catch (err) {
          console.log('[space] watch error:', err.message)
        }
      }
    }
  }

  stopWatching () {
    if (this._watch) { this._watch.destroy(); this._watch = null }
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
