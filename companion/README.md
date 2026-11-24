# Waffle companion

Run `npm ci`, then `npm run dev` and open http://localhost:5174. For a production build run `npm run build`, then `npm start` and open http://localhost:3002.

For LAN access run `npm run lan` and open `http://<this-computer's-LAN-IP>:8000`. Only the web port is exposed; the API and Ollama can stay on localhost. Stop any existing development server before switching modes, since both use API port 3002. For production LAN serving, use `WAFFLE_HOST=0.0.0.0 npm start` after building, then open port 3002. LAN devices share the local room and its saved data; local mode has no sign-in.

The full local setup, model connection instructions, storage behavior, and first-version limits are documented in the [workspace README](../README.md).

- `npm run check`: TypeScript checks.
- `npm test`: API, provider, isolation, upload, and streaming tests.
- `npm run build`: React client and portable hosted Worker.
- `npm run db:generate`: append a migration after editing `db/schema.ts`.

The generated artwork and its exact prompts are documented in [ARTWORK.md](ARTWORK.md).

Switch between light and dark mode with the moon/sun button in the header or the Dark mode toggle in Settings. The room saves your preference, and a device-local cache applies it during startup. Existing room records and backups without a theme continue to use light mode.

In **Settings → Fine-tune the conversation**, use **Conversation prompt** for shared conversation instructions and **Response style** for language, tone, length, or formatting preferences. Both are saved with the room and included in the system message sent to Ollama or OpenRouter, alongside the selected companion’s personality and memory. Style preferences take priority over the companion’s usual tone or reply length. Clearing either field removes those extra instructions from future requests; existing messages are kept. Demo replies remain scripted.
