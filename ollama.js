import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const defaultUrl = 'http://127.0.0.1:11434'

async function isListening(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
    await response.body?.cancel()
    return true
  } catch (error) {
    return error.cause?.code !== 'ECONNREFUSED'
  }
}

async function start(executable) {
  return new Promise((resolve) => {
    const child = spawn(executable, ['serve'], {
      detached: true, windowsHide: true, stdio: 'ignore',
    })
    child.once('error', () => resolve(null))
    child.once('spawn', () => {
      child.unref()
      resolve(child)
    })
  })
}

export async function ensureOllama() {
  const endpoint = new URL(process.env.OLLAMA_URL || defaultUrl)
  if (!['http://127.0.0.1:11434', 'http://localhost:11434'].includes(endpoint.origin)) return
  if (await isListening(defaultUrl)) return

  const directories = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Ollama'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Ollama'),
  ].filter(Boolean)
  for (const directory of directories) {
    const executable = join(directory, 'ollama.exe')
    if (await access(executable).then(() => true, () => false) && await waitForOllama(executable)) return
  }
  await waitForOllama('ollama.exe')
}

async function waitForOllama(executable) {
  const child = await start(executable)
  if (!child) return false
  for (let attempt = 0; attempt < 24; attempt++) {
    await delay(500, undefined, { ref: false })
    if (await isListening(defaultUrl)) return true
    if (child.exitCode !== null || child.signalCode !== null) return false
  }
  return true
}
