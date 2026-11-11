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
const draftFormats = new Map()
const notices = new Map()
let models = []
let connected = false
const traitNames = { gender: 'Gender', mood: 'Mood', style: 'Conversation style' }
let editing = null
let storageFailed = false
const transcript = $('#messages')
const messageBox = $('#message')
const formatBar = $('.format-bar')
const formatControls = [...formatBar.querySelectorAll('[data-format]')]
const linkEditor = $('#link-editor')
const linkForm = $('#link-form')
const editor = $('#editor')
const buddyForm = $('#buddy-form')
const active = () => state.buddies.find(({ id }) => id === state.selected)
const chatWindow = $('.chat')
const customModelOption = ':'
const emojiPicker = $('#emoji-picker')
const emojiSearch = $('#emoji-search')
const emojiCategory = $('#emoji-category')
const emojiResults = $('#emoji-results')
const emojiStatus = $('#emoji-status')
let emojiCatalog

const portraits = {
  bot: [
    '................',
    '.......kk.......',
    '.......yk.......',
    '.......kk.......',
    '....kkkkkkkk....',
    '...khhhhhhhsk...',
    '..kkhhhhhhhskk..',
    '..kyhkwhkwssyk..',
    '..kyhkwhkwssyk..',
    '..kkhhhkhhsskk..',
    '...khkwwwkssk...',
    '...khhkkksssk...',
    '....kkkkkkkk....',
    '.....kssssk.....',
    '....kssssssk....',
    '...kkkkkkkkkk...',
  ],
  user: [
    '................',
    '.....kkkkkk.....',
    '....kbbbbbbk....',
    '...kbbbbbbddk...',
    '..kbbbbbbddddk..',
    '.kkkkkkkkkkkkkk.',
    '...kyyyyyyyk....',
    '...kykykyyyk....',
    '....kyyyyyk.....',
    '.....kkkkk......',
    '...kkbbdbbkk....',
    '..kbbbbdbbbbk...',
    '..kykbbdbbk yk..',
    '....kbbdbbk.....',
    '....kkk.kkk.....',
    '................',
  ],
}

function drawPortrait(canvas, art, accent) {
  const context = canvas.getContext('2d')
  const palette = {
    k: '#171e3e', y: '#ffdd57', h: '#fff394', s: accent, w: '#fff',
    b: '#3d9bdf', d: '#1b60a5',
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  art.forEach((row, y) => {
    Array.from(row).forEach((pixel, x) => {
      if (!palette[pixel]) return
      context.fillStyle = palette[pixel]
      context.fillRect(x, y, 1, 1)
    })
  })
}

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
    const openai = buddy.provider === 'openai'
    const ready = !openai && models.includes(buddy.model)
    const row = node('button', '', 'buddy' + (selected ? ' active' : '') + (ready ? ' ready' : ''))
    row.type = 'button'
    row.setAttribute('aria-pressed', selected)
    row.title = openai ? 'Choose an Ollama model in Edit Buddy'
      : (ready ? 'Model available' : 'Model unavailable')
    const label = node('span', '', 'buddy-text')
    label.append(node('strong', buddy.name), node('small', openai ? 'Ollama model required' : buddy.model))
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
  const openai = buddy?.provider === 'openai'
  const ready = !openai && connected
  const offline = openai ? 'Open Edit Buddy and choose an Ollama model.'
    : 'Start Ollama, then refresh the connection.'
  $('#notice').textContent = storageFailed ? 'Browser storage is unavailable. Changes may be lost after reload.'
    : notices.get(buddy?.id) || (buddy && !ready ? offline : '')
  $('#send').disabled = !buddy || busy || !ready || !messageBox.value.trim()
  $('#stop').hidden = !busy
  messageBox.disabled = !buddy
  for (const control of formatBar.querySelectorAll('button, input, select')) control.disabled = !buddy
}

function applyMessageFormat(element, format = {}) {
  const validColor = (color) => /^#[0-9a-f]{6}$/i.test(color || '') ? color : ''
  element.style.color = validColor(format.color)
  element.style.backgroundColor = validColor(format.backgroundColor)
  element.style.fontFamily = ['Arial', 'Tahoma', 'Georgia', 'Courier New'].includes(format.fontFamily) ? format.fontFamily : ''
  element.style.fontSize = ['12', '15', '18', '24'].includes(format.fontSize) ? format.fontSize + 'px' : ''
  element.style.fontWeight = format.bold ? 'bold' : ''
  element.style.fontStyle = format.italic ? 'italic' : ''
  element.style.textDecoration = format.underline ? 'underline' : ''
}

function renderDraftFormat() {
  const format = draftFormats.get(state.selected) || {}
  applyMessageFormat(messageBox, format)
  for (const control of formatControls) {
    const value = format[control.dataset.format]
    if (control.matches('button')) control.setAttribute('aria-pressed', Boolean(value))
    else control.value = value ?? (control.type === 'color' ? control.defaultValue : '')
  }
}

function appendLinks(body, text) {
  let offset = 0
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const address = match[0].replace(/[.,!?;]+$/, '')
    if (!URL.canParse(address)) continue
    const link = node('a', address)
    link.href = address
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    body.append(text.slice(offset, match.index), link)
    offset = match.index + address.length
  }
  body.append(text.slice(offset))
}

function appendMessage(buddy, message) {
  const row = node('div', '', 'entry ' + message.role)
  const time = node('time', timeFormat.format(message.time))
  time.dateTime = new Date(message.time).toISOString()
  const body = node('span', message.role === 'user' ? '' : message.content || 'Typing…')
  if (message.role === 'user') {
    appendLinks(body, message.content)
    applyMessageFormat(body, message.format)
  }
  const sender = message.role === 'user' ? 'You' : buddy.name
  row.append(node('strong', sender + ': '), body, time)
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
  $('#chat-title').textContent = buddy ? buddy.name + ' : You - Instant Message' : 'Instant Message'
  $('#model').textContent = buddy?.provider === 'openai' ? 'Ollama model required' : buddy?.model || ''
  const accents = ['#eab43f', '#ee9474', '#72c995', '#79b4ef', '#d595dc']
  drawPortrait($('#avatar'), portraits.bot, accents[glyphs.indexOf(buddy?.glyph)] || accents[0])
  $('#edit').disabled = !buddy
  messageBox.value = drafts.get(buddy?.id) || ''
  renderDraftFormat()
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
    if (editor.open) {
      const { model, customModel } = buddyForm.elements
      const manual = model.value === customModelOption
      setModelOptions(manual ? customModel.value : model.value, manual)
    }
    render()
  }
}

function syncCustomModel() {
  const { model, customModel } = buddyForm.elements
  const manual = model.value === customModelOption
  $('#custom-model').hidden = !manual
  customModel.disabled = !manual
  customModel.required = manual
}

function setModelOptions(selected, manual = false) {
  const { model, customModel } = buddyForm.elements
  const placeholder = new Option('Select an Ollama model', '')
  placeholder.disabled = true
  const options = models.map((name) => new Option(name, name))
  if (!manual && selected && !models.includes(selected)) {
    options.push(new Option(selected + ' (not listed)', selected))
  }
  model.replaceChildren(placeholder, ...options, new Option('Enter model name…', customModelOption))
  model.value = manual ? customModelOption : selected ?? models[0] ?? customModelOption
  customModel.value = manual ? selected : ''
  customModel.setCustomValidity('')
  syncCustomModel()
}

function openEditor(buddy) {
  editing = buddy?.id
  $('#editor-title').textContent = buddy ? 'Edit Buddy' : 'Add Buddy'
  $('#remove').hidden = !buddy
  buddyForm.elements.name.value = buddy?.name || ''
  const needsModel = buddy?.provider === 'openai'
  $('#legacy-provider-notice').hidden = !needsModel
  setModelOptions(needsModel ? '' : buddy?.model)
  for (const trait of Object.keys(traitNames)) {
    const field = buddyForm.elements[trait]
    field.value = buddy?.traits?.[trait] || ''
    if (field.selectedIndex < 0) field.value = ''
  }
  buddyForm.elements.prompt.value = buddy?.prompt || ''
  editor.showModal()
}

$('#connection').addEventListener('click', connect)
$('#maximize').addEventListener('click', (event) => {
  const expanded = chatWindow.classList.toggle('maximized')
  const button = event.currentTarget
  button.setAttribute('aria-pressed', expanded)
  button.setAttribute('aria-label', expanded ? 'Restore chat size' : 'Maximize chat')
  button.textContent = expanded ? '❐' : '□'
})
for (const control of formatControls) {
  const toggle = control.matches('button')
  control.addEventListener(toggle ? 'click' : 'input', () => {
    if (!active()) return
    const format = { ...draftFormats.get(state.selected) }
    const property = control.dataset.format
    format[property] = toggle ? !format[property] : control.value
    draftFormats.set(state.selected, format)
    renderDraftFormat()
    if (toggle) messageBox.focus()
  })
}
$('#clear-format').addEventListener('click', () => {
  draftFormats.delete(state.selected)
  renderDraftFormat()
  messageBox.focus()
})
$('#insert-link').addEventListener('click', () => {
  linkForm.reset()
  linkForm.elements.url.setCustomValidity('')
  linkEditor.showModal()
})
$('#cancel-link').addEventListener('click', () => linkEditor.close())
linkForm.elements.url.addEventListener('input', (event) => event.target.setCustomValidity(''))
linkForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const field = linkForm.elements.url
  const address = field.value.trim()
  const before = messageBox.value[messageBox.selectionStart - 1]
  const after = messageBox.value[messageBox.selectionEnd]
  const text = (before && !/\s/.test(before) ? ' ' : '') + address + (after && !/\s/.test(after) ? ' ' : '')
  if (!/^https?:\/\//i.test(address) || !URL.canParse(address)) {
    field.setCustomValidity('Enter a web address starting with https:// or http://.')
  } else if (!insertDraftText(text)) {
    field.setCustomValidity('The message is too long to add this link.')
  } else {
    linkEditor.close()
    messageBox.focus()
    return
  }
  field.reportValidity()
})
function renderEmoji() {
  if (!emojiCatalog) return
  const query = emojiSearch.value.trim().toLowerCase()
  const entries = query
    ? Object.values(emojiCatalog).flat().filter(([symbol, name]) => symbol === query || name.toLowerCase().includes(query))
    : emojiCatalog[emojiCategory.value]
  emojiResults.replaceChildren(...entries.map(([symbol, name], index) => {
    const button = node('button', symbol)
    button.type = 'button'
    button.tabIndex = index === 0 ? 0 : -1
    button.title = name
    button.setAttribute('aria-label', name)
    return button
  }))
  emojiResults.scrollTop = 0
  emojiStatus.textContent = entries.length ? '' : 'No matching emoji.'
}

$('#emoji').addEventListener('click', async () => {
  emojiSearch.value = ''
  emojiPicker.showModal()
  if (!emojiCatalog) {
    emojiStatus.textContent = 'Loading emoji…'
    try {
      const response = await fetch('/emoji.json')
      if (!response.ok) throw new Error('Emoji catalog unavailable')
      emojiCatalog = await response.json()
      emojiCategory.replaceChildren(...Object.keys(emojiCatalog).map((name) => new Option(name, name)))
    } catch {
      emojiStatus.textContent = 'Could not load emoji. Close the picker and try again.'
      return
    }
  }
  renderEmoji()
})
$('#close-emoji').addEventListener('click', () => emojiPicker.close())
emojiSearch.addEventListener('input', renderEmoji)
emojiCategory.addEventListener('change', () => {
  emojiSearch.value = ''
  renderEmoji()
})
emojiResults.addEventListener('keydown', (event) => {
  if (!event.target.matches('button')) return
  const columns = getComputedStyle(emojiResults).gridTemplateColumns.split(' ').length
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]
  if (!offset) return
  event.preventDefault()
  const index = Array.from(emojiResults.children).indexOf(event.target)
  const next = emojiResults.children[index + offset]
  if (!next) return
  event.target.tabIndex = -1
  next.tabIndex = 0
  next.focus()
})
emojiResults.addEventListener('click', (event) => {
  if (!event.target.matches('button')) return
  const face = event.target.textContent
  if (!insertDraftText(face)) {
    emojiStatus.textContent = 'The message is too long to add this emoji.'
    return
  }
  emojiPicker.close()
  messageBox.focus()
})

function insertDraftText(text) {
  const { selectionStart, selectionEnd, value, maxLength } = messageBox
  if (value.length - (selectionEnd - selectionStart) + text.length > maxLength) return false
  messageBox.setRangeText(text, selectionStart, selectionEnd, 'end')
  messageBox.dispatchEvent(new Event('input'))
  return true
}
$('#add').addEventListener('click', () => openEditor())
$('#edit').addEventListener('click', () => openEditor(active()))
$('#cancel').addEventListener('click', () => editor.close())
$('#remove').addEventListener('click', () => {
  const buddy = state.buddies.find(({ id }) => id === editing)
  if (!buddy || !confirm('Remove ' + buddy.name + ' and its conversation history?')) return
  jobs.get(buddy.id)?.controller.abort()
  state.buddies = state.buddies.filter(({ id }) => id !== editing)
  drafts.delete(editing)
  draftFormats.delete(editing)
  notices.delete(editing)
  state.selected = state.buddies[0]?.id || null
  save()
  editor.close()
  render()
})

buddyForm.addEventListener('input', (event) => event.target.setCustomValidity?.(''))
buddyForm.elements.model.addEventListener('change', syncCustomModel)
buddyForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const { name, model, customModel, prompt } = buddyForm.elements
  const modelField = customModel.disabled ? model : customModel
  for (const field of [name, modelField]) {
    if (field.value.trim()) continue
    field.setCustomValidity('Enter a value.')
    field.reportValidity()
    return
  }
  const traits = Object.fromEntries(Object.keys(traitNames).map((trait) => [trait, buddyForm.elements[trait].value]))
  const settings = { name: name.value.trim(), provider: 'ollama', model: modelField.value.trim(), prompt: prompt.value.trim(), traits }
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
  if (!buddy || buddy.provider === 'openai' || !connected || !content || jobs.has(buddy.id)) return

  const job = {
    controller: new AbortController(),
    reply: { role: 'assistant', content: '', time: Date.now() },
    body: null,
  }
  const userMessage = { role: 'user', content, time: Date.now(), format: draftFormats.get(buddy.id) }
  buddy.messages.push(userMessage)
  drafts.delete(buddy.id)
  draftFormats.delete(buddy.id)
  notices.delete(buddy.id)
  jobs.set(buddy.id, job)
  save()
  render()

  try {
    const messages = buddy.messages.map(({ role, content }) => ({ role, content }))
    const traits = Object.entries(traitNames).filter(([trait]) => buddy.traits?.[trait])
      .map(([trait, label]) => label + ': ' + buddy.traits[trait])
    const personality = traits.length ? 'Portray this buddy with these defaults when consistent with the system prompt.\n' + traits.join('\n') : ''
    const instructions = [buddy.prompt, personality].filter(Boolean).join('\n\n')
    if (instructions) messages.unshift({ role: 'system', content: instructions })
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
        if (!drafts.get(buddy.id)) {
          drafts.set(buddy.id, content)
          if (!draftFormats.has(buddy.id) && userMessage.format) draftFormats.set(buddy.id, userMessage.format)
        }
      }
    }
  } finally {
    if (state.buddies.includes(buddy) && job.reply.content.trim()) buddy.messages.push(job.reply)
    jobs.delete(buddy.id)
    save()
    if (state.selected === buddy.id) render()
  }
})

drawPortrait($('#user-avatar'), portraits.user)
render()
connect()
