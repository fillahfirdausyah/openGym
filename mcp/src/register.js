/* Shared MCP server construction: one McpServer with the nine read-only tools registered. Both
   transports use it — stdio (index.js) and streamable HTTP (http.js) — so the two entry points
   cannot drift apart on tool names, schemas, or how a result is wrapped for the LLM. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TOOLS } from './tools.js'

export function createMcpServer() {
  const server = new McpServer({ name: 'opengym', version: '0.1.0' })
  for (const t of TOOLS) {
    server.tool(
      t.name,
      t.description,
      t.schema,
      async (params) => {
        try {
          const result = t.handler(params || {})
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (err) {
          const code = err.code || 'ERROR'
          return {
            isError: true,
            content: [{ type: 'text', text: `${code}: ${err.message}` }]
          }
        }
      }
    )
  }
  return server
}
