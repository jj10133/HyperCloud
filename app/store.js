//
//  store.js
//  App
//
//  Created by Janardhan on 2026-04-11.
//

'use strict'

const fs   = require('bare-fs')
const path = require('bare-path')
const os   = require('bare-os')

const DRIFT_DIR    = path.join(os.homedir(), '.drift')
const SPACES_FILE  = path.join(DRIFT_DIR, 'spaces.json')
const SYNC_DIR     = path.join(os.homedir(), 'Drift')

function init () {
  fs.mkdirSync(DRIFT_DIR, { recursive: true })
  fs.mkdirSync(SYNC_DIR,  { recursive: true })
}

// ── Spaces ───────────────────────────────────────────────────────────────────

function loadSpaces () {
  try {
    return JSON.parse(fs.readFileSync(SPACES_FILE, 'utf8'))
  } catch {
    return []
  }
}

function saveSpaces (spaces) {
  fs.writeFileSync(SPACES_FILE, JSON.stringify(spaces, null, 2))
}

function addSpace (space) {
  const spaces = loadSpaces()
  spaces.push(space)
  saveSpaces(spaces)
}

function removeSpace (id) {
  const spaces = loadSpaces().filter(s => s.id !== id)
  saveSpaces(spaces)
}

function getSpace (id) {
  return loadSpaces().find(s => s.id === id) || null
}

// ── Folder paths ─────────────────────────────────────────────────────────────

function spacePath (name) {
  return path.join(SYNC_DIR, name)
}

function ensureSpaceFolder (name) {
  const p = spacePath(name)
  fs.mkdirSync(p, { recursive: true })
  return p
}

module.exports = {
  DRIFT_DIR,
  SYNC_DIR,
  init,
  loadSpaces,
  saveSpaces,
  addSpace,
  removeSpace,
  getSpace,
  spacePath,
  ensureSpaceFolder
}
