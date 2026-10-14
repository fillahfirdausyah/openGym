// HTTP-transport tests: the same nine tools, now reachable by a remote agent over streamable
// HTTP instead of a locally-spawned stdio process. Drives real JSON-RPC handshakes through a
// live server on an ephemeral port — no mocking of the SDK — so a break in the transport wiring
// fails here, not when an agent tries to connect.
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

let current = null // { httpServer, closeAllSessions } — torn down in afterEach

async function startServer() {
  const { httpServer, closeAllSessions } = await createHttpServer({ token: TOKEN })
  await new Promise(resolve => httpServer.listen(0, resolve))
  const base = `http://127.0.0.1:${httpServer.address().port}`
  current = { httpServer, closeAllSessions }
  return base
}

afterEach(async () => {
  if (!current) return
  await current.closeAllSessions()
  await new Promise(resolve => current.httpServer.close(resolve))
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

// Runs the handshake through `initialize` and returns the session id, so a test can assert on
// what happens *after* a client is connected without repeating the boilerplate.
async function initSession(base) {
  const init = await post(base, 'initialize', initParams())
  expect(init.status).toBe(200)
  const sessionId = init.headers.get('mcp-session-id')
  expect(sessionId).toBeTruthy()
  await post(base, 'notifications/initialized', {}, { sessionId, notification: true })
  return sessionId
}

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

  // Regression test for the exact bug a first version of this server shipped with: ONE shared
  // transport per process meant a second client's `initialize` was rejected with "Server already
  // initialized" the moment a first client connected — which is what broke the claude.ai
  // connector the instant anyone else (or a stray curl) had already talked to the server.
  test('two independent clients can each initialize their own session', async () => {
    const base = await startServer()
    const sessionA = await initSession(base)
    const sessionB = await initSession(base)
    expect(sessionA).not.toBe(sessionB)

    // Each session's own tools/list still answers, independently of the other.
    const listA = await post(base, 'tools/list', {}, { sessionId: sessionA })
    const listB = await post(base, 'tools/list', {}, { sessionId: sessionB })
    expect(listA.status).toBe(200)
    expect(listB.status).toBe(200)
  })

  test('a request naming an unknown session id is rejected, not silently given a new one', async () => {
    const base = await startServer()
    const res = await post(base, 'tools/list', {}, { sessionId: 'not-a-real-session' })
    expect(res.status).toBe(400)
  })

  test('serves the nine tools through the handshake', async () => {
    const base = await startServer()
    const sessionId = await initSession(base)

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
