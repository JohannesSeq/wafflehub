import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileKeyStore } from '../server/key-store';
import { createApp, type Bindings } from '../server/app';
import { initialState, sakura } from '../src/defaults';

const request = (body: unknown) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function fixture(run: (filename: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'waffle-credentials-'));
  try { await run(join(directory, 'private', 'provider-keys.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('local keys survive reinitialization with owner-only file and directory permissions', async () => fixture(async filename => {
  const store = createFileKeyStore(filename);
  assert.deepEqual(await store.read(), {});
  await store.update({ openrouter: 'saved-router-test', elevenlabs: 'saved-voice-test' });
  const restored = createFileKeyStore(filename);
  assert.deepEqual(await restored.read(), { openrouter: 'saved-router-test', elevenlabs: 'saved-voice-test' });
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.equal((await stat(join(filename, '..'))).mode & 0o777, 0o700);
}));

test('concurrent updates preserve unrelated keys and removing one key keeps the other', async () => fixture(async filename => {
  const store = createFileKeyStore(filename);
  await Promise.all([store.update({ openrouter: 'router-first' }), store.update({ elevenlabs: 'voice-first' })]);
  assert.deepEqual(await store.read(), { openrouter: 'router-first', elevenlabs: 'voice-first' });
  await store.update({ openrouter: 'router-replacement' });
  assert.deepEqual(await store.read(), { openrouter: 'router-replacement', elevenlabs: 'voice-first' });
  await store.update({ openrouter: null });
  assert.deepEqual(await createFileKeyStore(filename).read(), { elevenlabs: 'voice-first' });
}));

test('invalid key updates and corrupted files cannot silently overwrite existing credentials', async () => fixture(async filename => {
  const store = createFileKeyStore(filename);
  await store.update({ openrouter: 'keep-this-test-key' });
  assert.throws(() => store.update({ openrouter: 'bad\nkey' }));
  assert.throws(() => store.update({ openrouter: '' }));
  assert.equal((await store.read()).openrouter, 'keep-this-test-key');
  await writeFile(filename, '{"openrouter":"keep-this-test-key"');
  await assert.rejects(store.update({ elevenlabs: 'voice-test' }), error => !String(error).includes('keep-this-test-key'));
  assert.equal(await readFile(filename, 'utf8'), '{"openrouter":"keep-this-test-key"');
}));

test('local credential API returns status only and rejects cross-origin or hosted writes', async () => fixture(async filename => {
  const app = createApp();
  const env = { LOCAL_MODE: true, keyStore: createFileKeyStore(filename) };
  const saved = await app.request('/api/keys', request({ openrouter: 'never-return-router', elevenlabs: 'never-return-voice' }), env);
  assert.equal(saved.status, 200);
  const metadata = await saved.text();
  assert.ok(!metadata.includes('never-return'));
  assert.deepEqual(JSON.parse(metadata).stored, { openrouter: true, elevenlabs: true });
  const health = await app.request('/api/health', undefined, env);
  assert.ok(!(await health.text()).includes('never-return'));
  const foreign = await app.request('http://192.168.88.19:6767/api/keys', { ...request({ openrouter: null }), headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' } }, env);
  assert.equal(foreign.status, 403);
  const hosted = await app.request('/api/keys', { ...request({ openrouter: 'hosted-test' }), headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': 'owner' } }, { keyStore: env.keyStore });
  assert.equal(hosted.status, 404);
  assert.equal((await env.keyStore.read()).openrouter, 'never-return-router');
  assert.equal((await app.request('/api/keys', undefined, env)).status, 404);
}));

test('model discovery, chat, and voice use stored credentials without browser keys after restart', async () => fixture(async filename => {
  const firstApp = createApp();
  const save = await firstApp.request('/api/keys', request({ openrouter: 'router-on-disk', elevenlabs: 'voice-on-disk' }), { LOCAL_MODE: true, keyStore: createFileKeyStore(filename) });
  assert.equal(save.status, 200);
  const received: string[] = [];
  const app = createApp((async (url, options) => {
    const headers = new Headers(options?.headers);
    if (String(url).includes('elevenlabs.io')) { received.push(headers.get('xi-api-key')!); return new Response('test audio', { headers: { 'Content-Type': 'audio/mpeg' } }); }
    received.push(headers.get('Authorization')!);
    return String(url).endsWith('/models') ? Response.json({ data: [{ id: 'test/model' }] }) : new Response('data: {"choices":[{"delta":{"content":"A reply."}}]}\n\ndata: [DONE]\n\n');
  }) as typeof fetch);
  const env: Bindings = { LOCAL_MODE: true, keyStore: createFileKeyStore(filename) };
  const settings = { ...initialState().settings, provider: 'openrouter', model: 'test/model' };
  const post = (body: unknown) => ({ ...request(body), method: 'POST' });
  assert.equal((await app.request('/api/models', post({ settings }), env)).status, 200);
  assert.equal((await app.request('/api/chat', post({ settings, companion: sakura, messages: [{ id: 'user', role: 'user', content: 'Hello', createdAt: new Date().toISOString() }] }), env)).status, 200);
  assert.equal((await app.request('/api/voice', post({ text: 'Hello', voiceId: 'voice1', model: 'eleven_flash_v2_5' }), env)).status, 200);
  assert.deepEqual(received, ['Bearer router-on-disk', 'Bearer router-on-disk', 'voice-on-disk']);
}));

test('explicit request keys override saved keys; saved keys override environment defaults', async () => fixture(async filename => {
  const store = createFileKeyStore(filename); await store.update({ openrouter: 'saved-test' });
  const seen: string[] = [];
  const app = createApp((async (_url, options) => { seen.push(new Headers(options?.headers).get('Authorization')!); return Response.json({ data: [] }); }) as typeof fetch);
  const env = { LOCAL_MODE: true, keyStore: store, OPENROUTER_API_KEY: 'environment-test' };
  const settings = { ...initialState().settings, provider: 'openrouter' };
  const post = (body: unknown) => ({ ...request(body), method: 'POST' });
  await app.request('/api/models', post({ settings }), env);
  await app.request('/api/models', post({ settings, key: 'temporary-test' }), env);
  await store.update({ openrouter: null });
  await app.request('/api/models', post({ settings }), env);
  assert.deepEqual(seen, ['Bearer saved-test', 'Bearer temporary-test', 'Bearer environment-test']);
}));

test('disk errors and provider errors never reveal saved API key values', async () => fixture(async filename => {
  const app = createApp((async () => Response.json({ error: { message: 'Invalid saved-redaction-test' } }, { status: 401 })) as typeof fetch);
  const store = createFileKeyStore(filename); await store.update({ openrouter: 'saved-redaction-test' });
  const response = await app.request('/api/models', { ...request({ settings: { ...initialState().settings, provider: 'openrouter' } }), method: 'POST' }, { LOCAL_MODE: true, keyStore: store });
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('saved-redaction-test'));
  const broken = { LOCAL_MODE: true, keyStore: { async read() { return {}; }, async update() { throw new Error('private-disk-test'); } } };
  const failure = await app.request('/api/keys', request({ openrouter: 'unsaved-test' }), broken);
  assert.equal(failure.status, 500); assert.ok(!(await failure.text()).includes('private-disk-test'));
}));
