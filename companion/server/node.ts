import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, type Bindings, type Store } from './app';

const dataDir = join(process.cwd(), '.data');
await mkdir(join(dataDir, 'art'), { recursive: true, mode: 0o700 });
const database = new DatabaseSync(join(dataDir, 'waffle.sqlite'));
database.exec('PRAGMA journal_mode = WAL');
database.exec('CREATE TABLE IF NOT EXISTS __local_migrations (name TEXT PRIMARY KEY)');
for (const name of (await readdir('drizzle')).filter(n => n.endsWith('.sql')).sort()) {
  if (!database.prepare('SELECT name FROM __local_migrations WHERE name = ?').get(name)) {
    database.exec('BEGIN');
    try {
      database.exec(await readFile(join('drizzle', name), 'utf8'));
      database.prepare('INSERT INTO __local_migrations (name) VALUES (?)').run(name);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
}
const store: Store = {
  async readState(owner) { return (database.prepare('SELECT data FROM companion_states WHERE user_id = ?').get(owner) as {data: string} | undefined)?.data ?? null; },
  async writeState(owner, data) { database.prepare('INSERT INTO companion_states (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(owner, data, new Date().toISOString()); },
  async putArt(key, bytes) { await mkdir(join(dataDir, 'art', key.split('/')[0]), { recursive: true }); await writeFile(join(dataDir, 'art', key), new Uint8Array(bytes), { mode: 0o600 }); },
  async getArt(key) { try { const bytes = await readFile(join(dataDir, 'art', key)); return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, type: key.endsWith('.png') ? 'image/png' : key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp' }; } catch { return null; } },
};
const env: Bindings = { LOCAL_MODE: true, store, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL };
const app = createApp();
app.use('/*', serveStatic({ root: existsSync('dist/client/index.html') ? './dist/client' : './public' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const port = Number(process.env.PORT || 3002);
const hostname = process.env.WAFFLE_HOST || '127.0.0.1';
const server = serve({ fetch: request => app.fetch(request, env), port, hostname }, () => console.log(`Waffle API: http://${hostname}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(); database.close(); process.exit(0); });
