#!/usr/bin/env node
/* openGym MCP server — streamable HTTP transport. The stdio transport (index.js) only works when
   the LLM client can spawn this process on the box that holds the data. A remote agent (a hosted
   LLM, or Hermes on another machine) cannot, so it needs this instead: the same nine read-only
   tools, running beside the data volume, reachable over HTTP. The one real difference is auth —
   over a network the filesystem is no longer the boundary, so a bearer token gates every read. */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './register.js'
import { init, getUser } from './state.js'

// Stateful, so one transport serves the whole process: `initialize` hands the client a session id
// it echoes back on every later call (the standard streamable-HTTP handshake). enableJsonResponse
// keeps each tool call a plain JSON round-trip rather than an SSE stream — simpler for agents and
// the proxies in front of them.
export async function createHttpServer({ token } = {}) {
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true
  })
  await server.connect(transport)

  const httpServer = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0]

    // Health first, unauthenticated: Dokploy/Traefik poll it, and it reveals nothing.
    if (pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized — send "Authorization: Bearer <OPENGYM_TOKEN>"' }))
      return
    }

    transport.handleRequest(req, res).catch(err => {
      console.error(`[opengym-mcp] request failed: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal error' }))
      }
    })
  })

  return { httpServer, transport, server }
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
