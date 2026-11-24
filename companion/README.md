# Waffle companion

Run `npm ci`, then `npm run dev` and open http://localhost:5174. For a production build run `npm run build`, then `npm start` and open http://localhost:3002.

For LAN access run `npm run lan` and open `http://<this-computer's-LAN-IP>:6767`. Only the web port is exposed; the API and Ollama can stay on localhost. If UFW is enabled, allow TCP port 6767 from your LAN subnet. Stop any existing development server before switching modes, since both use API port 3002. For production LAN serving, use `WAFFLE_HOST=0.0.0.0 npm start` after building, then open port 3002. LAN devices share the local room and its saved data; local mode has no sign-in.

The full local setup, model connection instructions, storage behavior, and first-version limits are documented in the [workspace README](../README.md).

- `npm run check`: TypeScript checks.
- `npm test`: API, provider, isolation, upload, and streaming tests.
- `npm run test:chat`: isolated browser tests for message edits, saved alternatives, real touch swipes, regeneration failure/cancellation, and retry. Start the app first; this uses mocked room/provider requests and does not change saved user data. Defaults to localhost port 6767; set `WAFFLE_TEST_URL` for another running URL.
- `npm run test:keys`: isolated browser tests for saved-key status after refresh, replacement/removal, empty-field preservation, storage errors, and hosted fallback. Room and credential writes are mocked, so real keys are left untouched.
- `npm run build`: React client and portable hosted Worker.
- `npm run db:generate`: append a migration after editing `db/schema.ts`.

The generated artwork and its exact prompts are documented in [ARTWORK.md](ARTWORK.md).

Local API keys entered in Settings are saved by **Save preferences** to `.data/provider-keys.json`, with owner-only file permissions. Refreshes and server restarts reuse them automatically. Empty password fields keep saved keys; enter a replacement or use **Remove saved key** to change them. Saved values stay on the server, and the UI receives status flags only. The file is explicitly Git-ignored and excluded from publishing; `.data/` is also blocked from development-server file access. Keys are excluded from browser storage and room JSON exports. Full `.data/` backups include them. Optional `.env` keys are used when no saved override exists. Hosted mode uses environment keys or temporary tab-only keys.

Switch between light and dark mode with the moon/sun button in the header or the Dark mode toggle in Settings. The room saves your preference, and a device-local cache applies it during startup. Existing room records and backups without a theme continue to use light mode.

In **Settings → Fine-tune the conversation**, use **Conversation prompt** for shared conversation instructions and **Response style** for language, tone, length, or formatting preferences. Both are saved with the room and included in the system message sent to Ollama or OpenRouter, alongside the selected companion’s personality and memory. Style preferences take priority over the companion’s usual tone or reply length. Clearing either field removes those extra instructions from future requests; existing messages are kept. Demo replies remain scripted.

Use the pencil below a chat message to edit your message or the companion’s reply. Save with **Save edit** or Ctrl/Cmd+Enter, or cancel with Escape. Edits update the selected text in place; later messages remain unchanged.

Use **Regenerate reply** to keep the original and generate another answer to the same preceding conversation. Swipe left/right on a reply on touch devices, or use the previous/next controls, to select a saved alternative. Moving forward past the last saved alternative generates a fresh one. The counter shows which reply is selected; only that reply is used in future model context. Each message can keep up to 20 replies, including the original. Editing one reply does not alter its other alternatives. Edits and alternatives are included in saved rooms and JSON exports.

Regeneration leaves the saved reply intact until a new response completes. Cancelling, reloading, or a provider error preserves the original; unfinished generated text is not saved as an alternative. If a new response fails or is stopped, **Generate reply** retries the existing user message without sending it twice. The opening greeting can be edited; send a message first to enable regeneration. Demo regeneration cycles through scripted alternatives.
