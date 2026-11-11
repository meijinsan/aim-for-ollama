const $ = (selector) => document.querySelector(selector)
const storageKey = 'aim-for-ollama:v1'
const glyphs = ['✦', '◆', '☀', '☾', '✿']
const timeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })

function restore() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || { buddies: [], selected: null }
  } catch {
    return { buddies: [], selected: null }
  }
}

const state = restore()
const jobs = new Map()
const drafts = new Map()
const notices = new Map()
let models = []
let connected = false
let editing = null
let storageFailed = false
const transcript = $('#messages')
const messageBox = $('#message')
const editor = $('#editor')
const buddyForm = $('#buddy-form')
const active = () => state.buddies.find(({ id }) => id === state.selected)

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
    storageFailed = false
  } catch {
    storageFailed = true
  }
}

function node(tag, value, className) {
  const element = document.createElement(tag)
  element.textContent = value
  if (className) element.className = className
  return element
}

function renderRoster() {
  $('#count').textContent = state.buddies.length
  $('#buddies').replaceChildren(...state.buddies.map((buddy) => {
    const selected = buddy.id === state.selected
    const ready = models.includes(buddy.model)
    const row = node('button', '', 'buddy' + (selected ? ' active' : '') + (ready ? ' ready' : ''))
    row.type = 'button'
    row.setAttribute('aria-pressed', selected)
    row.title = ready ? 'Model available' : 'Model unavailable'
    const label = node('span', '', 'buddy-text')
    label.append(node('strong', buddy.name), node('small', buddy.model))
    row.append(node('span', buddy.glyph, 'avatar'), label, node('span', '', 'dot'))
    row.addEventListener('click', () => {
      state.selected = buddy.id
      save()
      render()
      messageBox.focus()
    })
    return row
  }))
}

function renderComposer() {
  const buddy = active()
  const busy = jobs.has(buddy?.id)
  $('#notice').textContent = storageFailed ? 'Browser storage is unavailable. Changes may be lost after reload.'
    : notices.get(buddy?.id) || (buddy && !connected ? 'Start Ollama, then refresh the connection.' : '')
  $('#send').disabled = !buddy || busy || !connected || !messageBox.value.trim()
  $('#stop').hidden = !busy
  messageBox.disabled = !buddy
}

function appendMessage(buddy, message) {
  const row = node('div', '', 'entry ' + message.role)
  const time = node('time', timeFormat.format(message.time))
  time.dateTime = new Date(message.time).toISOString()
  const body = node('div', message.content || 'Typing…')
  row.append(node('strong', message.role === 'user' ? 'You' : buddy.name), time, body)
  transcript.append(row)
  return body
}

function scrollToLatest() {
  transcript.scrollTop = transcript.scrollHeight
}

function renderTranscript() {
  const buddy = active()
  transcript.replaceChildren()
  if (!buddy?.messages.length) {
    transcript.append(node('p', buddy ? 'Send an instant message to ' + buddy.name + '.' :
      'Add a buddy to start chatting with an Ollama model.', 'empty'))
  }
  if (buddy) {
    for (const message of buddy.messages) appendMessage(buddy, message)
    const job = jobs.get(buddy.id)
    if (job) job.body = appendMessage(buddy, job.reply)
  }
  scrollToLatest()
}

function render() {
  const buddy = active()
  $('#chat-title').textContent = buddy ? buddy.name + ' — Instant Message' : 'Instant Message'
  $('#name').textContent = buddy?.name || 'Select a buddy'
  $('#model').textContent = buddy?.model || ''
  $('#avatar').textContent = buddy?.glyph || '✦'
  $('#edit').disabled = !buddy
  messageBox.value = drafts.get(buddy?.id) || ''
  renderRoster()
  renderTranscript()
  renderComposer()
}

async function connect() {
  const button = $('#connection')
  const label = button.querySelector('span')
  button.disabled = true
  label.textContent = 'Checking Ollama…'
  try {
    const response = await fetch('/api/tags', { cache: 'no-store' })
    if (!response.ok) throw new Error('Connection failed')
    const data = await response.json()
    models = data.models.map(({ name }) => name)
    connected = true
    if (!state.initialized && models.length && !state.buddies.length) {
      const buddy = {
        id: crypto.randomUUID(), name: 'OllamaBuddy', model: models[0], glyph: glyphs[0],
        prompt: '', messages: [],
      }
      state.buddies.push(buddy)
      state.selected = buddy.id
      state.initialized = true
      save()
    }
  } catch {
    models = []
    connected = false
  } finally {
    label.textContent = connected ? 'Ollama connected' : 'Ollama offline'
    button.classList.toggle('online', connected)
    button.disabled = false
    $('#status-models').textContent = connected
      ? models.length + (models.length === 1 ? ' model available' : ' models available')
      : 'Local Ollama · port 11434 by default'
    $('#installed-models').replaceChildren(...models.map((model) => new Option(model, model)))
    render()
  }
}

function openEditor(buddy) {
  editing = buddy?.id
  $('#editor-title').textContent = buddy ? 'Edit Buddy' : 'Add Buddy'
  $('#remove').hidden = !buddy
  buddyForm.elements.name.value = buddy?.name || ''
  buddyForm.elements.model.value = buddy?.model || models[0] || ''
  buddyForm.elements.prompt.value = buddy?.prompt || ''
  editor.showModal()
}

$('#connection').addEventListener('click', connect)
$('#add').addEventListener('click', () => openEditor())
$('#edit').addEventListener('click', () => openEditor(active()))
$('#cancel').addEventListener('click', () => editor.close())
$('#remove').addEventListener('click', () => {
  const buddy = state.buddies.find(({ id }) => id === editing)
  if (!buddy || !confirm('Remove ' + buddy.name + ' and its conversation history?')) return
  jobs.get(buddy.id)?.controller.abort()
  state.buddies = state.buddies.filter(({ id }) => id !== editing)
  drafts.delete(editing)
  notices.delete(editing)
  state.selected = state.buddies[0]?.id || null
  save()
  editor.close()
  render()
})

buddyForm.addEventListener('input', (event) => event.target.setCustomValidity?.(''))
buddyForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const { name, model, prompt } = buddyForm.elements
  for (const field of [name, model]) {
    if (field.value.trim()) continue
    field.setCustomValidity('Enter a value.')
    field.reportValidity()
    return
  }
  const settings = { name: name.value.trim(), model: model.value.trim(), prompt: prompt.value.trim() }
  const buddy = state.buddies.find(({ id }) => id === editing)
  if (buddy) Object.assign(buddy, settings)
  else {
    state.selected = crypto.randomUUID()
    state.buddies.push({
      ...settings, id: state.selected, messages: [], glyph: glyphs[state.buddies.length % glyphs.length],
    })
  }
  state.initialized = true
  notices.delete(state.selected)
  save()
  editor.close()
  render()
})

messageBox.addEventListener('input', () => {
  if (active()) drafts.set(state.selected, messageBox.value)
  renderComposer()
})
messageBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (!$('#send').disabled) $('#compose').requestSubmit()
  }
})
$('#stop').addEventListener('click', () => jobs.get(state.selected)?.controller.abort())

$('#compose').addEventListener('submit', async (event) => {
  event.preventDefault()
  const buddy = active()
  const content = messageBox.value.trim()
  if (!buddy || !connected || !content || jobs.has(buddy.id)) return

  const job = {
    controller: new AbortController(),
    reply: { role: 'assistant', content: '', time: Date.now() },
    body: null,
  }
  const userMessage = { role: 'user', content, time: Date.now() }
  buddy.messages.push(userMessage)
  drafts.delete(buddy.id)
  notices.delete(buddy.id)
  jobs.set(buddy.id, job)
  save()
  render()

  try {
    const messages = buddy.messages.map(({ role, content }) => ({ role, content }))
    if (buddy.prompt) messages.unshift({ role: 'system', content: buddy.prompt })
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: buddy.model, messages, stream: true }),
      signal: job.controller.signal,
    })
    if (!response.ok) {
      const raw = await response.text()
      let error = raw
      try { error = JSON.parse(raw).error } catch {}
      throw new Error(error || 'Ollama returned HTTP ' + response.status + '.')
    }
    let buffer = ''
    let done = false
    const consume = (line) => {
      if (!line.trim()) return
      const chunk = JSON.parse(line)
      if (chunk.error) throw new Error(chunk.error)
      if (chunk.done) done = true
      if (chunk.message?.content) {
        job.reply.content += chunk.message.content
        if (state.selected === buddy.id) {
          const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 32
          job.body.textContent = job.reply.content
          if (nearBottom) scrollToLatest()
        }
      }
    }
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) consume(line)
    }
    consume(buffer)
    if (!done) throw new Error('Ollama ended the response early.')
    if (!job.reply.content.trim()) throw new Error('Ollama returned an empty reply.')
  } catch (error) {
    if (state.buddies.includes(buddy)) {
      notices.set(buddy.id, job.controller.signal.aborted ? 'Reply stopped.' : error.message)
      if (!job.reply.content.trim()) {
        buddy.messages.pop()
        if (!drafts.get(buddy.id)) drafts.set(buddy.id, content)
      }
    }
  } finally {
    if (state.buddies.includes(buddy) && job.reply.content.trim()) buddy.messages.push(job.reply)
    jobs.delete(buddy.id)
    save()
    if (state.selected === buddy.id) render()
  }
})

render()
connect()
