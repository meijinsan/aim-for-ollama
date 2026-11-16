import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ollama = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const assets = {
  '/': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
  '/emoji.json': ['emoji.json', 'application/json'],
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
  const clawChat = path === '/api/openclaw/chat'
  const chat = req.method === 'POST' && (path === '/api/chat' || clawChat)
  if (req.method === 'GET' && path === '/api/openclaw/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ configured: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim()) }))
    return
  }
  if (!list && !chat) {
    res.writeHead(404).end()
    return
  }
  if ((req.headers.origin && req.headers.origin !== origin) ||
      (clawChat && req.headers.origin !== origin) ||
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
    const body = chat ? Buffer.concat(chunks) : undefined
    if (clawChat) {
      await openClawReply(body, res, controller.signal)
      return
    }
    const response = await fetch(new URL(path, ollama), {
      method: req.method,
      headers: chat ? { 'Content-Type': 'application/json' } : {},
      body,
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
    res.end(JSON.stringify({ error: clawChat ? 'Could not reach the local OpenClaw Gateway.' : 'Could not reach Ollama. Start Ollama and try again.' }))
  }
}

async function openClawReply(body, res, signal) {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data) + '\n')
  }
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim()
  if (!token) return send(503, { error: 'Set OPENCLAW_GATEWAY_TOKEN and restart AIM.' })
  const port = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return send(503, { error: 'OPENCLAW_GATEWAY_PORT must be a valid local port.' })
  }
  let request
  try {
    request = JSON.parse(body)
  } catch {
    return send(400, { error: 'Invalid chat request.' })
  }
  const { model, messages } = request || {}
  if (typeof model !== 'string' || !/^openclaw\/[a-z0-9_-]+$/i.test(model) || !Array.isArray(messages)) {
    return send(400, { error: 'Enter an OpenClaw agent such as openclaw/default.' })
  }
  const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    return send(response.status, { error: 'OpenClaw returned HTTP ' + response.status + '. Check the Gateway token, chat endpoint, and agent ID.' })
  }
  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    return send(502, { error: 'OpenClaw returned no chat reply.' })
  }
  send(200, { message: { content }, done: true })
}
