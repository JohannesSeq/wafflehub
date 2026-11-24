# Waffle ♡

A cozy illustrated 2D companion app built with React, TypeScript, Vite, and a lightweight Hono backend on Node.js. Create companions, customize personalities and prompts, chat through Ollama or OpenRouter, and optionally hear replies through ElevenLabs or your browser’s speech service.

## Run locally

Requires Node.js 22.13 or newer; Node.js 24+ is recommended for built-in SQLite support.

```sh
npm run setup
npm run dev
```

Open **http://localhost:5174**. The API runs on **127.0.0.1:3002**. These ports avoid the existing services on this machine. Production: `npm run build`, then `npm start` and open **http://localhost:3002**.

The first run opens Sakura’s room in **demo mode**, with clearly labeled scripted replies. No AI model, provider key, or model download is included.

## Access over LAN

Run **`npm run lan`**, then open **http://192.168.88.19:8000** from another device on the same network. This computer’s current LAN IP is `192.168.88.19`; the general address is `http://<this-computer's-LAN-IP>:8000`. Port 8000 is already permitted by this machine’s UFW configuration.

Keep the app running on this computer. The web interface proxies API requests to `127.0.0.1:3002`, so only the web port needs to be reachable. Ollama can stay on localhost; remote browsers use this computer’s backend to reach it. `npm run dev` uses port 5174 instead; stop the current server before switching commands, since both use API port 3002.

For a production build, run `npm run build`, then `WAFFLE_HOST=0.0.0.0 npm start` and use port **3002** instead. The default production binding remains localhost. If a firewall is enabled, allow only the chosen port from your LAN subnet.

All LAN devices use the same local room, companions, settings, and conversation history. Local mode has no sign-in, so use it on a trusted network. The web interface supports plain HTTP LAN access; some browser features such as clipboard access may require HTTPS.

Use the moon/sun button in the header, or **Settings → Dark mode**, to switch between the soft light and dark palettes. Your choice is saved with your room and cached on this device so dark mode is applied while the room loads. Older room backups default to light mode.

## Connect a model

Personalize AI behavior in **Settings → Fine-tune the conversation** with the **Conversation prompt** and **Response style** fields. They are saved with your room and sent with each Ollama or OpenRouter chat request, alongside the companion’s personality and memories. Set the language, tone, length, and formatting you prefer; leave the fields empty for the companion’s usual style. Demo replies stay scripted.

- **Ollama:** run Ollama on this computer, download a suitable model, choose “Ollama / local compatible server” in Settings, use `http://127.0.0.1:11434/v1`, and test the connection to discover installed model IDs. A compatible localhost server such as LM Studio or llama.cpp also works if it serves `/models` and streaming `/chat/completions` beneath the configured base URL.
- **OpenRouter:** choose OpenRouter, enter a key in Settings, test the connection, and select a model ID.
- **ElevenLabs:** choose ElevenLabs as the voice provider, enter a key, and put the desired voice ID in the companion’s Studio. Replies are sent to ElevenLabs for synthesis.
- **Browser voice:** uses `speechSynthesis`. Voice availability and offline support depend on the browser and OS.

Keys entered in Settings remain in the current tab’s memory, are forwarded to the backend for provider requests, and are never included in database records or exports. Refreshing the page clears those keys. For persistent server credentials, copy `companion/.env.example` to `companion/.env` and fill in the optional variables. Keep that file private.

Ollama is available only when Waffle is running locally. A hosted preview cannot reach the user’s localhost. Hosted chat supports OpenRouter and ElevenLabs through its backend.

## Companion Studio and storage

The Studio edits names, traits, background, first greeting, system prompt, explicit memory notes, voice ID, accent color, and portrait. Upload PNG, JPEG, or WebP portraits up to 5 MB. Original transparent artwork is included.

This first version animates the portrait gently; it is **not a rigged Live2D character**. Expression meshes, lip synchronization, outfit rigs, microphone input, and an in-browser illustration editor are future work. The Games section is intentionally omitted.

Locally, the database and uploaded portraits live in `companion/.data/` (ignored by Git). Back up that folder to preserve everything. A room JSON export includes companions, conversation text, settings, and artwork references; it does not embed uploaded images or API keys. Companion exports omit installation-specific image references, so upload the portrait again on another installation.

Hosted builds use a user-scoped D1 state table and R2 portrait storage. The hosted Site remains private; the platform supplies the signed-in user identity. Room writes are debounced and serialized within a tab. Concurrent tabs use last-write-wins; there is no live collaboration. Conversation history is capped at 200 messages per companion, 30 companions, and 1.5 MB total state. Memory notes are explicit; automatic long-term memory is not implemented.

## Development

```sh
cd companion
npm run check
npm test
npm run build
```

For the browser flow, keep the development server running in another terminal, install its test browser with `npx playwright install chromium`, then run `npm run test:browser` from `companion/`. The test temporarily changes the local room and restores it afterward. Run it against a development installation without concurrent edits.

Source lives in `companion/src/` and `companion/server/`. `server/app.ts` contains shared API routes. `server/node.ts` adapts them to local Node.js and SQLite; `server/worker.ts` adapts them to hosted execution. `scripts/build-worker.mjs` bundles the frontend assets into the portable Worker. Schema changes use `db/schema.ts` and `npm run db:generate`; local Node startup applies pending SQL migrations. Hosted publication applies those migrations to D1.

Original artwork was made with the built-in imagegen tool. Asset locations and exact generation prompts are in [companion/ARTWORK.md](companion/ARTWORK.md).
