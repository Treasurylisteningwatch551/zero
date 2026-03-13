import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebMessageHandler } from '@zero-os/channel'
import { Hono } from 'hono'
import type { ZeroOS } from '../../server/src/main'
import { createRoutes } from './api/routes'

const WEB_DIST = join(import.meta.dir, '../dist')

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

const port = Number(process.env.PORT ?? 3001)

export function startWebServer(zero: ZeroOS): { port: number } {
  const app = createRoutes(zero)

  const server = new Hono()
  server.route('/', app)

  // Feishu webhook — only url_verification; events delivered via WSClient
  server.post('/webhook/feishu', async (c) => {
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }
    if (body.type === 'url_verification') {
      return c.json({ challenge: body.challenge })
    }
    return c.json({}, 200)
  })

  // SPA fallback
  server.get('*', (c) => {
    const indexPath = join(WEB_DIST, 'index.html')
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, 'utf-8')
      return c.html(html)
    }
    return c.text('Web UI not built. Run: bun run build:web', 404)
  })

  // WebSocket handler
  const wsHandler = new WebMessageHandler()
  const wsClients = new Map<string, { ws: unknown }>()

  Bun.serve<{ clientId: string }>({
    port,
    async fetch(req, srv) {
      const url = new URL(req.url)

      // WebSocket upgrade
      if (url.pathname === '/ws') {
        const clientId = crypto.randomUUID()
        const upgraded = srv.upgrade(req, { data: { clientId } })
        if (upgraded) return undefined as unknown as Response
        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      // Serve static assets directly via Bun.file
      if (url.pathname.startsWith('/assets/')) {
        const filePath = join(WEB_DIST, url.pathname)
        const file = Bun.file(filePath)
        if (await file.exists()) {
          const ext = url.pathname.slice(url.pathname.lastIndexOf('.'))
          return new Response(file, {
            headers: {
              'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        }
      }

      // Everything else goes through Hono
      return server.fetch(req)
    },
    websocket: {
      open(ws: any) {
        const clientId = ws.data?.clientId ?? crypto.randomUUID()
        wsClients.set(clientId, { ws })
      },
      async message(ws: any, message: string | Buffer) {
        const clientId = ws.data?.clientId
        if (!clientId) return
        const raw = typeof message === 'string' ? message : message.toString()
        const response = await wsHandler.handleMessage(clientId, raw)
        if (response) {
          ws.send(JSON.stringify(response))
        }
      },
      close(ws: any) {
        const clientId = ws.data?.clientId
        if (clientId) {
          wsHandler.removeClient(clientId)
          wsClients.delete(clientId)
        }
      },
    },
  })

  // Bridge globalBus → WebSocket clients
  zero.bus.on('*', (payload) => {
    const msg = JSON.stringify({
      type: 'event',
      topic: payload.topic,
      data: payload.data,
    })
    for (const [clientId, { ws }] of wsClients) {
      if (wsHandler.isSubscribed(clientId, payload.topic)) {
        try {
          ;(ws as any).send(msg)
        } catch {
          // Client disconnected
          wsClients.delete(clientId)
          wsHandler.removeClient(clientId)
        }
      }
    }
  })

  return { port }
}
