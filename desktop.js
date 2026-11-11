import { app, BrowserWindow, dialog, protocol } from 'electron'
import { createAimServer } from './server.js'
import { ensureOllama } from './ollama.js'

const scheme = 'aim'
const home = 'aim://desktop/'
protocol.registerSchemesAsPrivileged([{
  scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

let window
let server
app.setAppUserModelId('local.aim.ollama')

async function open() {
  server = createAimServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const backend = 'http://127.0.0.1:' + server.address().port
  const ollamaReady = ensureOllama().catch((error) => console.error('Ollama startup:', error.message))
  protocol.handle(scheme, async (request) => {
    const { hostname, pathname } = new URL(request.url)
    if (hostname !== 'desktop') return new Response(null, { status: 404 })
    if (pathname === '/api/tags') await ollamaReady
    const headers = { Origin: backend }
    const type = request.headers.get('content-type')
    if (type) headers['Content-Type'] = type
    return fetch(backend + pathname, {
      method: request.method, headers, body: request.body, duplex: 'half', signal: request.signal,
    })
  })
  window = new BrowserWindow({
    width: 1080, height: 740, minWidth: 340, minHeight: 480,
    autoHideMenuBar: true, backgroundColor: '#0c2255',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  await window.loadURL(home)
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(open).catch((error) => {
    dialog.showErrorBox('AIM for Ollama could not start', error.message)
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    server?.close()
    server?.closeAllConnections()
  })
} else {
  app.quit()
}
