import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, providerConnection, type Bindings, type Store } from '../server/app';
import { initialState, sakura } from '../src/defaults';
import { readChatStream } from '../src/lib';
import { addReply, selectReply } from '../src/conversation';

function memoryStore(): Store {
  const state = new Map<string, string>();
  const art = new Map<string, {bytes: ArrayBuffer; type: string}>();
  return { async readState(k) { return state.get(k) ?? null; }, async writeState(k, v) { state.set(k, v); }, async putArt(k, bytes, type) { art.set(k, {bytes, type}); }, async getArt(k) { return art.get(k) ?? null; } };
}
function json(body: unknown, user = 'owner') { return { method: 'POST', headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': user }, body: JSON.stringify(body) }; }

test('hosted data requires identity; health does not expose configured keys', async () => {
  const app = createApp(); const env = { OPENROUTER_API_KEY: 'a-server-secret' };
  assert.equal((await app.request('/api/state', undefined, env)).status, 401);
  const response = await app.request('/api/health', undefined, env);
  const body = await response.text();
  assert.ok(body.includes('"openrouter":true'));
  assert.ok(!body.includes('a-server-secret'));
});

test('persistent states are isolated by signed-in user and exclude unknown secrets', async () => {
  const app = createApp(); const env = { store: memoryStore() };
  const data = initialState();
  data.settings.conversationPrompt = 'Help me explore creative ideas.';
  data.settings.responseStyle = 'Use concise Spanish replies.';
  data.chats[data.activeId][0] = addReply(data.chats[data.activeId][0], { id: 'saved-alternative', content: 'A saved alternative.', createdAt: new Date().toISOString() });
  const response = await app.request('/api/state', { ...json({ ...data, secrets: {openrouter: 'dont-save-me'}, settings: { ...data.settings, apiKey: 'dont-save-me-either' } }), method: 'PUT' }, env);
  assert.equal(response.status, 200);
  const owner = await app.request('/api/state', { headers: { 'oai-authenticated-user-id': 'owner' } }, env);
  const saved = await owner.text();
  assert.ok(saved.includes('Sakura')); assert.ok(!saved.includes('dont-save-me'));
  assert.equal(JSON.parse(saved).data.settings.conversationPrompt, data.settings.conversationPrompt);
  assert.equal(JSON.parse(saved).data.settings.responseStyle, data.settings.responseStyle);
  assert.equal(JSON.parse(saved).data.chats[data.activeId][0].selectedVariant, 1);
  assert.equal(JSON.parse(saved).data.chats[data.activeId][0].variants.length, 2);
  const other = await app.request('/api/state', { headers: { 'oai-authenticated-user-id': 'someone-else' } }, env);
  assert.deepEqual(await other.json(), { data: null });
});

test('rejects cross-origin writes and malformed state', async () => {
  const app = createApp(); const env = { store: memoryStore(), LOCAL_MODE: true };
  const init = json(initialState());
  const badOrigin = await app.request('http://localhost:3002/api/state', { ...init, method: 'PUT', headers: { ...init.headers, Origin: 'https://untrusted.example' } }, env);
  assert.equal(badOrigin.status, 403);
  const malformed = await app.request('/api/state', { ...json({ version: 1 }), method: 'PUT' }, env);
  assert.equal(malformed.status, 400);
});

test('allows same-origin LAN writes while rejecting requests from another LAN origin', async () => {
  const app = createApp(); const env = { store: memoryStore(), LOCAL_MODE: true };
  const request = json(initialState());
  const origin = 'http://192.168.88.19:6767';
  const sameOrigin = await app.request(`${origin}/api/state`, { ...request, method: 'PUT', headers: { ...request.headers, Origin: origin } }, env);
  assert.equal(sameOrigin.status, 200);
  const differentOrigin = await app.request(`${origin}/api/state`, { ...request, method: 'PUT', headers: { ...request.headers, Origin: 'http://192.168.88.20:6767' } }, env);
  assert.equal(differentOrigin.status, 403);
});

test('local model endpoints cannot target arbitrary hosts or be reached from hosting', () => {
  assert.throws(() => providerConnection({ provider: 'ollama', baseUrl: 'http://169.254.169.254/v1' }, undefined, { LOCAL_MODE: true }), /localhost/);
  assert.throws(() => providerConnection({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }, undefined, {}), /run|local Waffle/);
  assert.equal(providerConnection({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1/' }, 'cloud-secret', { LOCAL_MODE: true }).url, 'http://127.0.0.1:11434/v1');
});

for (const provider of ['openrouter', 'ollama'] as const) test(`${provider} chat forwards personality, memory, custom instructions, bounded context, and streams without buffering`, async () => {
  let upstreamBody: any;
  let upstreamHeaders: Headers;
  const mock = (async (url, options) => {
    assert.equal(url, provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'http://127.0.0.1:11434/v1/chat/completions');
    upstreamBody = JSON.parse(options!.body as string);
    upstreamHeaders = new Headers(options?.headers);
    return new Response('data: {"choices":[{"delta":{"content":"Hello!"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  const app = createApp(mock);
  const state = initialState();
  const conversationPrompt = 'Help me practice discussing books without giving away spoilers.';
  const responseStyle = 'Reply in Spanish, in two short paragraphs, without emojis.';
  const messages = [0,1,2,3].map(i => ({ id: String(i), role: i % 2 ? 'user' as const : 'assistant' as const, content: `message-${i}`, createdAt: new Date().toISOString() }));
  const selected = selectReply(addReply(messages[2], { id: 'hidden-alternative', content: 'An unselected reply.', createdAt: new Date().toISOString() }), 0);
  const response = await app.request('/api/chat', json({ settings: { ...state.settings, provider, model: 'test/model', contextMessages: 2, conversationPrompt, responseStyle }, key: 'test-key', companion: { ...sakura, memory: 'The user loves books.' }, messages: messages.map((message, index) => index === 2 ? selected : message) }), { LOCAL_MODE: provider === 'ollama' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type')!, /event-stream/);
  assert.match(await response.text(), /Hello!/);
  assert.equal(upstreamHeaders!.get('Authorization'), provider === 'openrouter' ? 'Bearer test-key' : 'Bearer ollama');
  assert.equal(upstreamBody.stream, true);
  assert.equal(upstreamBody.messages.length, 3);
  assert.match(upstreamBody.messages[0].content, /Sakura/);
  assert.match(upstreamBody.messages[0].content, /loves books/);
  assert.ok(upstreamBody.messages[0].content.includes(conversationPrompt));
  assert.ok(upstreamBody.messages[0].content.includes(responseStyle));
  assert.ok(upstreamBody.messages[0].content.indexOf(responseStyle) > upstreamBody.messages[0].content.indexOf(sakura.prompt));
  assert.equal(upstreamBody.messages[1].content, 'message-2');
  assert.deepEqual(Object.keys(upstreamBody.messages[1]).sort(), ['content', 'role']);
  assert.ok(!JSON.stringify(upstreamBody.messages).includes('An unselected reply.'));
});

test('provider errors redact a server-configured key', async () => {
  const app = createApp((async () => Response.json({ error: {message: 'Invalid token server-secret'} }, {status: 401})) as typeof fetch);
  const state = initialState();
  const response = await app.request('/api/models', json({ settings: { ...state.settings, provider: 'openrouter' } }), { OPENROUTER_API_KEY: 'server-secret' });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes('server-secret')); assert.match(text, /redacted/);
});

test('voice uses the selected voice and speech model through the backend', async () => {
  const app = createApp((async (url, options) => {
    assert.match(String(url), /\/text-to-speech\/voice123\/stream$/);
    assert.equal(new Headers(options?.headers).get('xi-api-key'), 'voice-secret');
    assert.deepEqual(JSON.parse(options!.body as string), { text: 'Hello there.', model_id: 'eleven_flash_v2_5' });
    return new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'audio/mpeg' } });
  }) as typeof fetch);
  const response = await app.request('/api/voice', json({ text: 'Hello there.', voiceId: 'voice123', model: 'eleven_flash_v2_5', key: 'voice-secret' }), {});
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
});

test('portrait uploads reject SVG even when mislabeled as PNG', async () => {
  const form = new FormData(); form.append('file', new File(['<svg><script>alert(1)</script></svg>'], 'portrait.png', {type: 'image/png'}));
  const response = await createApp().request('/api/upload', { method: 'POST', headers: { 'oai-authenticated-user-id': 'owner' }, body: form }, { store: memoryStore() });
  assert.equal(response.status, 400);
});

test('stream parser handles split UTF-8 characters, CRLF, keepalives, and an unterminated final line', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\ndata: {"choices":[{"delta":{"content":"Hi ♡"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" friend"}}]}');
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2)); controller.close(); } });
  const chunks: string[] = [];
  const result = await readChatStream(new Response(stream), text => chunks.push(text));
  assert.equal(result, 'Hi ♡ friend'); assert.deepEqual(chunks, ['Hi ♡', 'Hi ♡ friend']);
});

test('stream parser surfaces in-stream provider errors', async () => {
  await assert.rejects(() => readChatStream(new Response('data: {"error":{"message":"Out of credits"}}\n\n'), () => {}), /Out of credits/);
});
