# AIM for Ollama

A local, AIM-inspired instant messenger for chatting with Ollama and OpenAI models. Each buddy has a screen name, provider, model, optional system prompt, and its own conversation history.

## Windows desktop app

Double-click `dist/AIM-for-Ollama.exe`. For Ollama buddies, install Ollama first. AIM checks for the local Ollama server and starts `ollama serve` in the background if it is stopped. Ollama can stay running after AIM closes. Set `OLLAMA_URL` to use a custom endpoint. AIM only starts the default local Ollama server.

The desktop app stores its buddy list and conversations in its own Windows app profile. If you used the browser version, your existing chats are still in that browser.

To build the portable Windows x64 executable from source, run `npm.cmd ci` and then `npm.cmd run build:win`. The executable is unsigned. For desktop development, run `npm.cmd run desktop`.

## Run in a browser

1. Install Node.js 22 or newer and start Ollama with at least one installed chat model. Run `ollama list` to see your models.
2. Run `npm start` from this directory.
3. Open [AIM for Ollama](http://127.0.0.1:3000). The app creates an OllamaBuddy using the first available model. Use **Add Buddy** or **Edit Buddy** to configure your own.

The app defaults to Ollama at `http://127.0.0.1:11434`. Set the `OLLAMA_URL` environment variable before starting the app to use another Ollama instance. Set `PORT` to change the app's port.

## OpenAI buddies

In **Add Buddy** or **Edit Buddy**, choose **OpenAI** as the provider and select a GPT chat model listed for your API key. You can also enter a model ID manually. Ollama buddies use the local model list. Each buddy routes messages to its selected provider.

The **Personality** menus let you set gender presentation, mood, and conversation style for either provider. AIM includes selected traits as defaults alongside the buddy's system prompt.

Create an [OpenAI API key](https://platform.openai.com/api-keys) and add a Windows user environment variable named `OPENAI_API_KEY` with the key as its value. In the Start menu, search for **Edit environment variables for your account**, then choose **New** under **User variables**. Close and reopen AIM after saving it. The app reads the key in its backend and keeps it out of buddy profiles. OpenAI receives the buddy's conversation and bills usage to your API project.

## Project notes

- `server.js` serves the interface, discovers Ollama models, and streams replies from the selected provider. `web.js` starts it on the browser port. The Electron desktop app uses a stable `aim://desktop/` origin backed by its own loopback server on an available port.
- `public/app.js` manages the buddy list, settings, model discovery, and conversations. Buddy settings and history are stored in browser local storage for the current app URL. An active draft stays available while switching buddies in the same session.
- The chat window follows the Windows XP-era AIM layout. Pixel portraits are drawn on canvas from small color grids. The composer toolbar formats the whole outgoing message, inserts links, and opens an offline emoji picker. The model receives the message as plain text.
- The emoji catalog uses the Unicode Emoji 17.0 test data and includes fully qualified emoji and standalone components. See [Unicode data](https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt) and [license](UNICODE-LICENSE.txt).
- Ollama Modelfiles can provide model-level defaults. External tools and multi-agent orchestration are outside the current implementation.
- This repository is the handoff record. Use `git log --oneline` and the notes here to recover context. Update the notes when setup or architecture changes. Runtime conversations stay in browser storage.

## Verify changes

Run `node --check server.js` and `node --check public/app.js`. With the app running, check that the connection indicator finds Ollama, send a message and watch the response stream, then reload and confirm that the conversation persists. Add a second buddy with a different system prompt and check that its history is separate.
