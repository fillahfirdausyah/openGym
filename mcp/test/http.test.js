// HTTP-transport tests: the same nine tools, now reachable by a remote agent over streamable
// HTTP instead of a locally-spawned stdio process. Drives a real JSON-RPC handshake through a
// live server on an ephemeral port — no mocking of the SDK — so a break in the transport wiring
// fails here, not when the agent tries to connect.
//
// A fresh server per test, not one shared across the file: the transport is stateful (one
// session per process), so a second `initialize` against an already-initialized transport is
// rejected by the SDK — sharing one instance would make the auth-only tests below poison the
// handshake test that runs after them.
import { describe, beforeAll, afterEach, test, expect, vi } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { _seedStateForTests } from '../src/state.js'
import { createHttpServer } from '../src/http.js'

const TOKEN = 'test-token'
const FAKE_TODAY_ISO = '2026-07-27'
const PROTOCOL_VERSION = '2025-06-18'

beforeAll(() => {
  vi.useFakeTimers({ now: new Date(FAKE_TODAY_ISO + 'T12:00:00Z'), toFake: ['Date'] })
  _seedStateForTests(buildDemoState())
})

let current = null // { httpServer, transport, base } — torn down in afterEach

async function startServer() {
  const { httpServer, transport, server } = await createHttpServer({ token: TOKEN })
  await new Promise(resolve => httpServer.listen(0, resolve))
  const base = `http://127.0.0.1:${httpServer.address().port}`
  current = { httpServer, transport, server }
  return base
}

afterEach(async () => {
  if (!current) return
  await new Promise(resolve => current.httpServer.close(resolve))
  await current.transport.close()
  current = null
})

// A JSON-RPC POST to the MCP endpoint. `notification: true` omits the `id` — a notification, not
// a request, which the server answers 202 rather than 200. `url` overrides the endpoint path+query
// (e.g. to exercise the `?key=` auth path a client with no header control, like claude.ai's
// custom-connector dialog, has to use instead).
function post(base, method, params = {}, { sessionId, notification = false, auth = true, url = '/' } = {}) {
  return fetch(base + url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': PROTOCOL_VERSION } : {})
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: 1 }), method, params })
  })
}

const initParams = () => ({ protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } })

describe('opengym MCP over streamable HTTP', () => {
  test('GET /health answers unauthenticated', async () => {
    const base = await startServer()
    const res = await fetch(base + '/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('rejects a request with neither a bearer token nor a ?key= query param', async () => {
    const base = await startServer()
    const res = await post(base, 'initialize', initParams(), { auth: false })
    expect(res.status).toBe(401)
  })

  test('accepts the token as a ?key= query param, for a client that cannot set headers', async () => {
    // Mirrors claude.ai's custom-connector dialog: no way to set Authorization, only the URL.
    const base = await startServer()
    const res = await post(base, 'initialize', initParams(), { auth: false, url: `/?key=${TOKEN}` })
    expect(res.status).toBe(200)
  })

  test('a wrong ?key= is still rejected', async () => {
    const base = await startServer()
    const res = await post(base, 'initialize', initParams(), { auth: false, url: '/?key=wrong' })
    expect(res.status).toBe(401)
  })

  test('serves the nine tools through the handshake', async () => {
    const base = await startServer()

    // initialize → session id, server identity
    const init = await post(base, 'initialize', initParams())
    expect(init.status).toBe(200)
    const sessionId = init.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()
    const initBody = await init.json()
    expect(initBody.result.serverInfo.name).toBe('opengym')
    expect(initBody.result.serverInfo.version).toBe('0.1.0')

    // notifications/initialized is a notification, not a request — no id, answered 202
    const ack = await post(base, 'notifications/initialized', {}, { sessionId, notification: true })
    expect(ack.status).toBe(202)

    // tools/list
    const list = await post(base, 'tools/list', {}, { sessionId })
    expect(list.status).toBe(200)
    const names = (await list.json()).result.tools.map(t => t.name).sort()
    expect(names).toEqual([
      'estimate_1rm', 'get_bodyweight', 'get_routine', 'get_week_plan', 'get_workout',
      'list_routines', 'list_workouts', 'muscle_balance', 'preview_session'
    ])

    // tools/call — the seeded profile round-trips end to end
    const call = await post(base, 'tools/call', { name: 'list_routines', arguments: {} }, { sessionId })
    expect(call.status).toBe(200)
    const text = (await call.json()).result.content[0].text
    const data = JSON.parse(text)
    expect(Array.isArray(data.routines)).toBe(true)
    expect(data.routines.length).toBeGreaterThan(0)
    expect(data.routines[0]).toHaveProperty('name')
  })
})
