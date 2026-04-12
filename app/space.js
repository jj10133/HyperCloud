'use strict'

const Localdrive = require('localdrive')
const Localwatch = require('localwatch')
const RPC        = require('bare-rpc')
const crypto     = require('hypercore-crypto')
const fs         = require('bare-fs')
const path       = require('bare-path')
const store      = require('./store')

// peer protocol commands
const CMD_MANIFEST = 1
const CMD_GET      = 2
const CMD_PUT      = 3
const CMD_DEL      = 4

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
    this._peers  = new Map() // noiseKeyHex → rpc

    console.log('[space] created:', this.name, 'folder:', this._folder)
  }

  topic () { return this._topic }

  addPeer (conn, info, isInitiator) {
    const id = info.publicKey.toString('hex')
    if (this._peers.has(id)) return

    console.log('[space] addPeer', this.name, id.slice(0, 8), isInitiator ? '(initiator)' : '(responder)')

    const rpc = new RPC(conn, (req) => this._onRequest(req))

    conn.on('close', () => {
      console.log('[space] peer disconnected', this.name, id.slice(0, 8))
      this._peers.delete(id)
      this._emit('peer:disconnected', {
        spaceId: this.id, peerId: id, peers: this._peers.size
      })
    })

    conn.on('error', (err) => {
      console.log('[space] conn error', id.slice(0, 8), err.message)
    })

    this._peers.set(id, rpc)
    console.log('[space] peer added, total:', this._peers.size)

    this._emit('peer:connected', {
      spaceId: this.id, peerId: id, peers: this._peers.size
    })

    if (isInitiator) this._syncWithPeer(id)
  }

  async _onRequest (req) {
    switch (req.command) {

      case CMD_MANIFEST: {
        const manifest = await this._buildManifest()
        console.log('[space] sending manifest:', manifest.length, 'files')
        req.reply(Buffer.from(JSON.stringify(manifest)))
        break
      }

      case CMD_GET: {
        const key = req.data.toString()
        const abs = path.join(this._folder, key)
        console.log('[space] peer GET', key)
        try {
          req.reply(await fs.promises.readFile(abs))
        } catch {
          req.reply(Buffer.alloc(0))
        }
        break
      }

      case CMD_PUT: {
        const { key, data: b64 } = JSON.parse(req.data.toString())
        const buf = Buffer.from(b64, 'base64')
        const abs = path.join(this._folder, key)
        console.log('[space] peer PUT', key, buf.length, 'bytes')
        try {
          await fs.promises.mkdir(path.dirname(abs), { recursive: true })
          await fs.promises.writeFile(abs, buf)
          console.log('[space] wrote', key)
          this._emit('space:changed', {
            spaceId: this.id, type: 'update', key, peers: this._peers.size
          })
        } catch (err) {
          console.log('[space] PUT failed', err.message)
        }
        req.reply(Buffer.alloc(0))
        break
      }

      case CMD_DEL: {
        const key = req.data.toString()
        const abs = path.join(this._folder, key)
        console.log('[space] peer DEL', key)
        try {
          await fs.promises.unlink(abs)
          this._emit('space:changed', {
            spaceId: this.id, type: 'delete', key, peers: this._peers.size
          })
        } catch (err) {
          console.log('[space] DEL failed', err.message)
        }
        req.reply(Buffer.alloc(0))
        break
      }

      default:
        req.reply(Buffer.alloc(0))
    }
  }

  // wrap bare-rpc request in a promise
  _request (rpc, command, data) {
    return new Promise((resolve, reject) => {
      const req = rpc.request(command)
      req.on('response', (res) => resolve(res.data))
      req.on('error', reject)
      req.send(data)
    })
  }

  async _syncWithPeer (peerId) {
    console.log('[space] syncing with', peerId.slice(0, 8))
    const rpc = this._peers.get(peerId)
    if (!rpc) { console.log('[space] peer gone'); return }

    try {
      const raw        = await this._request(rpc, CMD_MANIFEST, Buffer.alloc(0))
      const theirFiles = JSON.parse(raw.toString())
      console.log('[space] peer has', theirFiles.length, 'files')

      const myManifest = await this._buildManifest()
      const myMap      = new Map(myManifest.map(f => [f.key, f]))

      for (const their of theirFiles) {
        const mine = myMap.get(their.key)
        if (!mine || their.mtime > mine.mtime) {
          console.log('[space] pulling', their.key)
          const data = await this._request(rpc, CMD_GET, Buffer.from(their.key))
          if (data && data.length > 0) {
            const abs = path.join(this._folder, their.key)
            await fs.promises.mkdir(path.dirname(abs), { recursive: true })
            await fs.promises.writeFile(abs, data)
            console.log('[space] synced', their.key)
          }
        }
      }

      console.log('[space] sync done')
    } catch (err) {
      console.log('[space] sync error:', err.message)
    }
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
        console.log('[space] change:', type, key, 'peers:', this._peers.size)

        try {
          if (type === 'update') {
            const data = await fs.promises.readFile(filename)
            for (const [id, rpc] of this._peers) {
              try {
                await this._request(rpc, CMD_PUT, Buffer.from(
                  JSON.stringify({ key, data: data.toString('base64') })
                ))
                console.log('[space] pushed', key, 'to', id.slice(0, 8))
              } catch (err) {
                console.log('[space] push failed to', id.slice(0, 8), err.message)
              }
            }
          } else if (type === 'delete') {
            for (const [id, rpc] of this._peers) {
              try {
                await this._request(rpc, CMD_DEL, Buffer.from(key))
                console.log('[space] del pushed to', id.slice(0, 8))
              } catch (err) {
                console.log('[space] del failed to', id.slice(0, 8), err.message)
              }
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
    this._peers.clear()
  }
}

module.exports = Space
