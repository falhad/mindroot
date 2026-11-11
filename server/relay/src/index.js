// Branchmint relay: passes Yjs updates between the people editing a shared map.
// It is a plain WebSocket server speaking the y-websocket protocol. It keeps one Yjs document per room in
// memory, saves it to DATA_DIR, and never looks at what is inside.
//
// Run:  SECRET=<16+ characters> PORT=8787 DATA_DIR=./data node src/index.js
// A reverse proxy (nginx, Caddy) should put TLS in front of it: the app connects with wss://.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { WebSocketServer } from 'ws'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { checkToken, ROOM_RE } from './auth.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

/**
 * @param {{ secret: string, dataDir?: string, port?: number, host?: string, maxRooms?: number, maxClientsPerRoom?: number,
 *           maxMessageBytes?: number, saveDelayMs?: number, idleMs?: number }} opts
 * @returns {Promise<{ port: number, close(): Promise<void> }>}
 */
export async function createRelay(opts) {
  const {
    secret,
    dataDir = './data',
    port = 8787,
    host = '127.0.0.1',
    maxRooms = 50,
    maxClientsPerRoom = 20,
    maxMessageBytes = 10 * 1024 * 1024,
    saveDelayMs = 2000,
    idleMs = 60_000,
  } = opts
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('SECRET must be at least 16 characters')
  mkdirSync(dataDir, { recursive: true })

  /** @type {Map<string, any>} */
  const rooms = new Map()
  const fileOf = (name) => join(dataDir, `${name}.bin`)

  const send = (ws, bytes) => {
    if (ws.readyState === 1) ws.send(bytes, (err) => err && ws.terminate())
  }

  function save(room) {
    clearTimeout(room.saveTimer)
    room.saveTimer = null
    const tmp = `${fileOf(room.name)}.tmp`
    writeFileSync(tmp, Y.encodeStateAsUpdate(room.doc))
    renameSync(tmp, fileOf(room.name)) // atomic: a crash never leaves half a file
  }

  function getRoom(name) {
    let room = rooms.get(name)
    if (room) return room
    const doc = new Y.Doc()
    if (existsSync(fileOf(name))) {
      try {
        Y.applyUpdate(doc, new Uint8Array(readFileSync(fileOf(name))))
      } catch {
        /* a damaged file starts an empty room; the clients bring their copies */
      }
    }
    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null)
    room = { name, doc, awareness, conns: new Map(), saveTimer: null, idleTimer: null }
    doc.on('update', (update, origin) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_SYNC)
      syncProtocol.writeUpdate(enc, update)
      const msg = encoding.toUint8Array(enc)
      for (const ws of room.conns.keys()) if (ws !== origin) send(ws, msg)
      clearTimeout(room.saveTimer)
      room.saveTimer = setTimeout(() => save(room), saveDelayMs)
    })
    awareness.on('update', ({ added, updated, removed }, origin) => {
      const owned = room.conns.get(origin)
      if (owned) {
        added.forEach((id) => owned.add(id))
        removed.forEach((id) => owned.delete(id))
      }
      const changed = added.concat(updated, removed)
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
      const msg = encoding.toUint8Array(enc)
      for (const ws of room.conns.keys()) send(ws, msg)
    })
    rooms.set(name, room)
    return room
  }

  function dropIfIdle(room) {
    clearTimeout(room.idleTimer)
    room.idleTimer = setTimeout(() => {
      if (room.conns.size) return
      save(room)
      room.awareness.destroy()
      room.doc.destroy()
      rooms.delete(room.name)
    }, idleMs)
  }

  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  const wss = new WebSocketServer({ server, maxPayload: maxMessageBytes })

  wss.on('connection', (ws, req) => {
    ws.binaryType = 'arraybuffer'
    const url = new URL(req.url ?? '/', 'http://relay')
    const name = url.pathname.slice(1)
    if (!ROOM_RE.test(name)) return ws.close(4400, 'bad room')
    if (!checkToken(secret, name, url.searchParams.get('token'))) return ws.close(4401, 'unauthorized')
    if (!rooms.has(name) && rooms.size >= maxRooms) return ws.close(4429, 'too many rooms')
    const room = getRoom(name)
    if (room.conns.size >= maxClientsPerRoom) return ws.close(4429, 'room is full')
    clearTimeout(room.idleTimer)
    room.conns.set(ws, new Set())

    ws.on('message', (data) => {
      try {
        const dec = decoding.createDecoder(new Uint8Array(data))
        const type = decoding.readVarUint(dec)
        if (type === MESSAGE_SYNC) {
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(dec, enc, room.doc, ws)
          if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
        } else if (type === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), ws)
        }
      } catch {
        ws.close(1007, 'bad message')
      }
    })
    ws.on('close', () => {
      const owned = room.conns.get(ws)
      room.conns.delete(ws)
      if (owned?.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...owned], null)
      if (!room.conns.size) dropIfIdle(room)
    })
    ws.on('error', () => ws.terminate())

    // start the handshake: our state vector, then who is here
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(enc, room.doc)
    send(ws, encoding.toUint8Array(enc))
    const states = room.awareness.getStates()
    if (states.size) {
      const a = encoding.createEncoder()
      encoding.writeVarUint(a, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]))
      send(ws, encoding.toUint8Array(a))
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const address = server.address()
  return {
    port: typeof address === 'object' && address ? address.port : port,
    async close() {
      for (const ws of wss.clients) ws.terminate()
      for (const room of rooms.values()) {
        clearTimeout(room.idleTimer)
        save(room)
      }
      rooms.clear()
      await new Promise((r) => wss.close(() => r(undefined)))
      await new Promise((r) => server.close(() => r(undefined)))
    },
  }
}

// started directly: read the settings from the environment
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const relay = await createRelay({
    secret: process.env.SECRET ?? '',
    dataDir: process.env.DATA_DIR ?? './data',
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? '127.0.0.1',
  })
  console.log(`Branchmint relay listening on port ${relay.port}`)
  const stop = async () => {
    await relay.close()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
