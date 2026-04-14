'use strict'

const fs   = require('bare-fs')
const path = require('bare-path')
const os   = require('bare-os')

const DRIFT_DIR   = path.join(os.homedir(), '.hypercloud')
const SPACES_FILE = path.join(DRIFT_DIR, 'spaces.json')
const SYNC_DIR    = path.join(os.homedir(), 'HyperCloud')

function init () {
  console.log('[store] DRIFT_DIR:', DRIFT_DIR)
  console.log('[store] SPACES_FILE:', SPACES_FILE)
  console.log('[store] SYNC_DIR:', SYNC_DIR)
  fs.mkdirSync(DRIFT_DIR, { recursive: true })
  fs.mkdirSync(SYNC_DIR,  { recursive: true })
}

function loadSpaces () {
  try {
    const raw = fs.readFileSync(SPACES_FILE, 'utf8')
    const spaces = JSON.parse(raw)
    console.log('[store] loaded', spaces.length, 'spaces from', SPACES_FILE)
    return spaces
  } catch (err) {
    console.log('[store] no spaces file found:', err.message)
    return []
  }
}

function saveSpaces (spaces) {
  console.log('[store] saving', spaces.length, 'spaces to', SPACES_FILE)
  fs.writeFileSync(SPACES_FILE, JSON.stringify(spaces, null, 2))
}

function addSpace (space) {
  const spaces = loadSpaces()
  spaces.push(space)
  saveSpaces(spaces)
  console.log('[store] added space:', space.name)
}

function removeSpace (id) {
  const spaces = loadSpaces().filter(s => s.id !== id)
  saveSpaces(spaces)
}

function getSpace (id) {
  return loadSpaces().find(s => s.id === id) || null
}

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
