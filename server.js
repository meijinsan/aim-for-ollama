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
  const openai = path === '/api/openai/chat'
  const openAIList = req.method === 'GET' && path === '/api/openai/models'
  const key = process.env.OPENAI_API_KEY?.trim()
  if (req.method === 'GET' && path === '/api/openai/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ configured: Boolean(key) }))
    return
  }
  const chat = req.method === 'POST' && (path === '/api/chat' || openai)
  if (!list && !chat && !openAIList) {
    res.writeHead(404).end()
    return
  }
  if ((req.headers.origin && req.headers.origin !== origin) ||
      (openai && req.headers.origin !== origin) ||
      (chat && req.headers['content-type']?.split(';')[0] !== 'application/json')) {
    res.writeHead(403).end()
    return
  }
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    if (openAIList) {
      await listOpenAIModels(key, controller.signal, res)
      return
    }
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
    if (openai) {
      await streamOpenAI(Buffer.concat(chunks), key, controller.signal, res)
      return
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
    res.end(JSON.stringify({ error: openai || openAIList ? 'Could not reach OpenAI. Try again.' : 'Could not reach Ollama. Start Ollama and try again.' }))
  }
}

async function listOpenAIModels(key, signal, res) {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  if (!key) return send(503, { error: 'Set OPENAI_API_KEY and restart AIM to load OpenAI models.' })
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: 'Bearer ' + key },
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    return send(response.status, { error: 'OpenAI could not list models. Check your API key and project permissions.' })
  }
  const { data } = await response.json()
  // The models endpoint has no capabilities field. Keep likely text models and offer manual entry.
  const ids = data.filter(({ id }) => typeof id === 'string' &&
    /^(?:gpt-|chatgpt-|o\d(?:-|$)|ft:(?:gpt-|o\d))/.test(id) &&
    !/(?:^|[-:])(?:audio|realtime|image|transcribe|tts|search|codex|instruct|diarize|embedding)(?:[-:]|$)/.test(id))
    .map(({ id }) => id)
  send(200, { models: [...new Set(ids)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) })
}

async function streamOpenAI(body, key, signal, res) {
  const fail = (status, error) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error }))
  }
  if (!key) return fail(503, 'Set OPENAI_API_KEY and restart AIM to use OpenAI buddies.')
  let request
  try {
    request = JSON.parse(body)
  } catch {
    return fail(400, 'Invalid chat request.')
  }
  if (typeof request?.model !== 'string' || !Array.isArray(request.messages)) {
    return fail(400, 'A model and conversation are required.')
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: request.model, input: request.messages, stream: true, store: false }),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    const messages = {
      400: 'OpenAI rejected this chat request. Check the model name and conversation length.',
      401: 'OpenAI rejected the API key. Check OPENAI_API_KEY and restart AIM.',
      403: 'Your OpenAI API project does not have access to this model.',
      404: 'OpenAI could not find this model. Check the model name and your project access.',
      429: 'OpenAI rate limit or quota reached. Check your API usage and billing.',
    }
    return fail(response.status, messages[response.status] || 'OpenAI could not complete the request.')
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
  await pipeline(openAIChunks(response.body), res)
}

async function* openAIChunks(body) {
  let pending = ''
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    pending += chunk
    const events = pending.split(/\r?\n\r?\n/)
    pending = events.pop()
    for (const event of events) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart()).join('\n')
      if (!data || data === '[DONE]') continue
      const { type, delta } = JSON.parse(data)
      if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
        yield JSON.stringify({ message: { content: delta } }) + '\n'
      } else if (type === 'response.completed') {
        yield '{"done":true}\n'
        return
      } else if (['error', 'response.failed', 'response.incomplete'].includes(type)) {
        yield '{"error":"OpenAI did not complete the reply."}\n'
        return
      }
    }
  }
}
