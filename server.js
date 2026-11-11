import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ollama = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const assets = {
  '/': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
}

export function createAimServer() {
  return createServer(handleRequest)
}

async function handleRequest(req, res) {
  const origin = 'http://' + req.headers.host
  const path = req.url.split('?')[0]
  const asset = Object.hasOwn(assets, path) && assets[path]
  const port = req.socket.localPort
  if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) {
    res.writeHead(403).end()
    return
  }
  if (req.method === 'GET' && asset) {
    const [file, type] = asset
    try {
      const contents = await readFile(new URL('./public/' + file, import.meta.url))
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(contents)
    } catch {
      res.writeHead(500).end()
    }
    return
  }
  const list = req.method === 'GET' && path === '/api/tags'
  const chat = req.method === 'POST' && path === '/api/chat'
  if (!list && !chat) {
    res.writeHead(404).end()
    return
  }
  if ((req.headers.origin && req.headers.origin !== origin) ||
      (chat && req.headers['content-type']?.split(';')[0] !== 'application/json')) {
    res.writeHead(403).end()
    return
  }
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    const chunks = []
    let size = 0
    if (chat) {
      for await (const chunk of req) {
        size += chunk.length
        if (size > 2_000_000) {
          res.writeHead(413).end('Conversation is too large.')
          return
        }
        chunks.push(chunk)
      }
    }
    const response = await fetch(new URL(path, ollama), {
      method: req.method,
      headers: chat ? { 'Content-Type': 'application/json' } : {},
      body: chat ? Buffer.concat(chunks) : undefined,
      signal: list ? AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) : controller.signal,
    })
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    })
    if (response.body) await pipeline(Readable.fromWeb(response.body), res)
    else res.end()
  } catch {
    if (res.headersSent || res.destroyed) {
      res.destroy()
      return
    }
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Could not reach Ollama. Start Ollama and try again.' }))
  }
}
