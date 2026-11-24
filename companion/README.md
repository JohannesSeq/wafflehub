# Waffle companion

Run `npm ci`, then `npm run dev` and open http://localhost:5174. For a production build run `npm run build`, then `npm start` and open http://localhost:3002.

The full local setup, model connection instructions, storage behavior, and first-version limits are documented in the [workspace README](../README.md).

- `npm run check`: TypeScript checks.
- `npm test`: API, provider, isolation, upload, and streaming tests.
- `npm run build`: React client and portable hosted Worker.
- `npm run db:generate`: append a migration after editing `db/schema.ts`.

The generated artwork and its exact prompts are documented in [ARTWORK.md](ARTWORK.md).

Switch between light and dark mode with the moon/sun button in the header or the Dark mode toggle in Settings. The room saves your preference, and a device-local cache applies it during startup. Existing room records and backups without a theme continue to use light mode.
