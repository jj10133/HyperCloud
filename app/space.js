//
//  space.js
//  App
//
//  Created by Janardhan on 2026-04-11.
//


'use strict'

const Localdrive        = require('localdrive')
const DistributedDrive  = require('distributed-drive')
const Localwatch        = require('localwatch')
const crypto            = require('hypercore-crypto')
const store             = require('./store')
const fs                = require('bare-fs')
const path              = require('bare-path')

class Space {
    constructor (opts, emit) {
        this.id      = opts.id      // uuid
        this.name    = opts.name    // display name e.g. "personal"
        this.key     = Buffer.from(opts.key, 'hex') // 32-byte secret
        this.paused  = opts.paused || false
        
        this._emit   = emit
        this._folder = store.ensureSpaceFolder(this.name)
        this._topic  = crypto.hash(this.key)
        
        this._local  = new Localdrive(this._folder)
        this._drive  = new DistributedDrive(this._local)
        this._watch  = null
        this._peers  = new Map() // noiseKey → conn
    }
    
    // ── Swarm ─────────────────────────────────────────────────────────────────
    
    topic () {
        return this._topic
    }
    
    addPeer (conn, info) {
        const id = info.publicKey.toString('hex')
        this._peers.set(id, conn)
        this._drive.addPeer(conn)
        
        conn.on('close', () => {
            this._peers.delete(id)
            this._emit('peer:disconnected', { spaceId: this.id, peerId: id })
        })
        
        this._emit('peer:connected', {
            spaceId: this.id,
            peerId:  id,
            peers:   this._peers.size
        })
    }
    
    peerCount () {
        return this._peers.size
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
                    const key = '/' + path.relative(this._folder, filename)
                    
                    try {
                        if (type === 'update') {
                            const data = await fs.promises.readFile(filename)
                            await this._drive.put(key, data)        // ← pushes to all peers
                        } else if (type === 'delete') {
                            await this._drive.del(key)              // ← tells all peers to delete
                        }
                        
                        this._emit('space:changed', {
                            spaceId: this.id,
                            type,
                            key,
                            peers: this._peers.size
                        })
                    } catch (err) {
                        // ignore transient errors (file in use, temp files etc)
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
    }
}

module.exports = Space
