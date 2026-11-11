# AIM for Ollama

A local, AIM-inspired instant messenger for chatting with Ollama models. Each buddy has a screen name, model, optional system prompt, and its own conversation history.

## Run locally

1. Install Node.js 22 or newer and start Ollama with at least one installed chat model. Run `ollama list` to see your models.
2. Run `npm start` from this directory.
3. Open [AIM for Ollama](http://127.0.0.1:3000). The app creates an OllamaBuddy using the first available model. Use **Add Buddy** or **Edit Buddy** to configure your own.

The app defaults to Ollama at `http://127.0.0.1:11434`. Set the `OLLAMA_URL` environment variable before starting the app to use another Ollama instance. Set `PORT` to change the app's port.

## Project notes

- `server.js` serves the interface and proxies model discovery and streamed chat to Ollama. The app listens on loopback and has no npm dependencies.
- `public/app.js` manages the buddy list, settings, model discovery, and conversations. Buddy settings and history are stored in browser local storage for the current app URL. An active draft stays available while switching buddies in the same session.
- A buddy is an Ollama chat profile. Ollama Modelfiles can provide model-level defaults. External tools and multi-agent orchestration are outside the current implementation.
- This repository is the handoff record. Use `git log --oneline` and the notes here to recover context. Update the notes when setup or architecture changes. Runtime conversations stay in browser storage.

## Verify changes

Run `node --check server.js` and `node --check public/app.js`. With the app running, check that the connection indicator finds Ollama, send a message and watch the response stream, then reload and confirm that the conversation persists. Add a second buddy with a different system prompt and check that its history is separate.
