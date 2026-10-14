#!/usr/bin/env node
/* openGym MCP server — streamable HTTP transport. The stdio transport (index.js) only works when
   the LLM client can spawn this process on the box that holds the data. A remote agent (a hosted
   LLM, Claude Desktop/Web, Cursor, or Hermes on another machine) cannot, so it needs this instead:
   the same nine read-only tools, running beside the data volume, reachable over HTTP. The two real
   differences from stdio are auth (a bearer token gates every read — over a network the filesystem
   is no longer the boundary) and session handling (more than one client can be connected, and each
   needs its own MCP session — see the comment above `sessions` below). */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from './register.js'
import { init, getUser } from './state.js'

// A client's first call is `initialize`, which this server answers by minting a session id (the
// `Mcp-Session-Id` response header) and a dedicated transport for that client; every later call
// from that client carries the header back and is routed to its own transport. One shared
// transport for the whole process — the first version of this file — breaks the moment a second
// client calls `initialize`: the SDK refuses to re-initialize an already-initialized transport, so
// client B's handshake fails with "Server already initialized" the instant client A connects. The
// map below is what every multi-client streamable-HTTP server needs; see the SDK's own
// `simpleStreamableHttp.ts` example, which this mirrors.
const sessions = new Map() // sessionId -> { transport, lastSeen }

const SESSION_IDLE_MS = 30 * 60 * 1000 // a client that vanishes without DELETE is reaped after this
setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) { sessions.delete(id); s.transport.close().catch(() => {}) }
  }
}, 5 * 60 * 1000).unref()

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

function sendJsonRpcError(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

async function newSession() {
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: sid => { sessions.set(sid, { transport, lastSeen: Date.now() }) },
    onsessionclosed: sid => { sessions.delete(sid) }
  })
  // Covers close paths onsessionclosed doesn't (an abrupt disconnect, our own idle sweep above).
  transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId) }
  await server.connect(transport)
  return transport
}

async function handleMcp(req, res) {
  const sessionId = req.headers['mcp-session-id']

  const known = sessionId && sessions.get(sessionId)
  if (known) {
    known.lastSeen = Date.now()
    await known.transport.handleRequest(req, res)
    return
  }

  // No known session. GET (the standalone SSE stream) and DELETE only ever address an existing
  // one — there is nothing to create here, unlike POST, which may be the `initialize` call that
  // starts a new one.
  if (req.method !== 'POST') {
    sendJsonRpcError(res, 400, 'Bad Request: No valid session ID provided')
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    sendJsonRpcError(res, 400, 'Parse error: Invalid JSON')
    return
  }
  if (!isInitializeRequest(body)) {
    sendJsonRpcError(res, 400, 'Bad Request: No valid session ID provided')
    return
  }

  const transport = await newSession()
  await transport.handleRequest(req, res, body)
}

export async function createHttpServer({ token } = {}) {
  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://opengym-mcp.internal')

    // Health first, unauthenticated: Dokploy/Traefik poll it, and it reveals nothing.
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // Two ways in: a bearer header (what Hermes/Claude Desktop/Cursor send) or a `?key=` query
    // param. The query param exists because claude.ai's custom-connector dialog has no way to
    // set a raw Authorization header for most orgs (the "Request headers" feature is a limited
    // beta) — its Remote MCP URL field is the only thing the user controls, so the token has to
    // travel there instead. Trade-off: a URL (unlike a header) ends up in the host's own access
    // logs. Acceptable for read-only training data behind a long random token; the header stays
    // the tighter choice for anything that supports it.
    const presented = req.headers.authorization === `Bearer ${token}` ? token : url.searchParams.get('key')
    if (token && presented !== token) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized — send "Authorization: Bearer <OPENGYM_TOKEN>", or append "?key=<OPENGYM_TOKEN>" to the URL for a client that cannot set headers' }))
      return
    }

    handleMcp(req, res).catch(err => {
      console.error(`[opengym-mcp] request failed: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal error' }))
      }
    })
  })

  // Test-only: close every open session's transport so a test run's sessions never leak past it.
  const closeAllSessions = () => Promise.all([...sessions.values()].map(s => s.transport.close().catch(() => {})))

  return { httpServer, closeAllSessions }
}

// Start only when run directly, not when imported (the loadability check and the tests import it).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const token = (process.env.OPENGYM_TOKEN || '').trim()
  if (!token) {
    console.error('[opengym-mcp] OPENGYM_TOKEN is required for the HTTP transport — refusing to expose a read of your data with no auth. Set it in the environment and restart.')
    process.exit(1)
  }
  const port = Number(process.env.PORT || 3200)

  try {
    init()
    const u = getUser()
    console.error(`[opengym-mcp] serving profile ${u.name} (${u.id}) over HTTP on :${port}`)
  } catch (e) {
    console.error(`[opengym-mcp] ${e.message}`)
  }

  const { httpServer } = await createHttpServer({ token })
  httpServer.listen(port, () => {
    console.error(`[opengym-mcp] listening on http://0.0.0.0:${port} (POST / for MCP, GET /health for liveness)`)
  })
}
