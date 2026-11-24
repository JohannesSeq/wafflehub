import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Mock room persistence and providers so this never changes a user's room or
// consumes provider credits. The app itself is served by the running LAN app.
const base = process.env.WAFFLE_TEST_URL || 'http://127.0.0.1:6767';
const browser = await chromium.launch({ headless: true });
await mkdir('.sites-runtime', { recursive: true });
const iso = new Date().toISOString();
const seededMessages = [
  { id: 'greeting', role: 'assistant', content: 'A friendly greeting.', createdAt: iso },
  { id: 'question', role: 'user', content: 'Tell me a short story.', createdAt: iso },
  { id: 'answer', role: 'assistant', content: 'The original story.', createdAt: iso },
];

async function setup(mobile = false) {
  const initial = (await (await fetch(`${base}/api/state`)).json()).data;
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1024 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let room = structuredClone(initial);
  const companion = room.companions.find(item => item.id === room.activeId) ?? room.companions[0];
  room.activeId = companion.id;
  room.settings = { ...room.settings, provider: 'ollama', model: 'test/model', voice: 'off', sound: false };
  room.chats[companion.id] = structuredClone(seededMessages);
  const requests = [];
  let mode = 'success';
  let release;
  await context.route('**/api/state', async route => {
    if (route.request().method() === 'PUT') { room = route.request().postDataJSON(); await route.fulfill({ json: { saved: true } }); }
    else await route.fulfill({ json: { data: room } });
  });
  await context.route('**/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    if (mode === 'fail') { await route.fulfill({ status: 502, json: { error: 'The test provider is unavailable.' } }); return; }
    if (mode === 'hold') await new Promise(resolve => { release = resolve; });
    try {
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: `Generated reply ${requests.length}.` } }] })}\n\ndata: [DONE]\n\n` });
    } catch { /* A cancelled fetch may have disconnected before release. */ }
  });
  await page.goto(base);
  await expect(page.getByRole('button', { name: /Switch to (light|dark) mode/ })).toBeEnabled();
  const answer = page.locator('[data-message-id="answer"]');
  const saved = () => room.chats[companion.id];
  return { page, context, answer, saved, requests, errors, companion, mode: value => { mode = value; }, release: () => release?.() };
}

try {
  const test = await setup();
  const { page, answer, saved, requests } = test;
  const question = page.locator('[data-message-id="question"]');
  await question.getByRole('button', { name: 'Edit your message' }).click();
  await page.getByRole('textbox', { name: 'Edit message text' }).fill('An unsaved question.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(question.locator('.message-bubble')).toHaveText('Tell me a short story.');
  await question.getByRole('button', { name: 'Edit your message' }).click();
  await page.getByRole('textbox', { name: 'Edit message text' }).fill('Tell me a story about the moon.');
  await expect(page.locator('.composer textarea')).toBeDisabled();
  await page.getByRole('button', { name: 'Save edit' }).click();
  await expect(question.locator('.message-bubble')).toHaveText('Tell me a story about the moon.');
  await expect(question.getByText('Edited', { exact: true })).toBeVisible();
  await expect(page.locator('.composer textarea')).toBeEnabled();
  await expect(answer.locator('.message-bubble')).toHaveText('The original story.');

  await answer.getByRole('button', { name: 'Regenerate reply', exact: true }).click();
  await expect(answer.locator('.message-bubble')).toHaveText('Generated reply 1.');
  await expect(answer.getByLabel('Reply 2 of 2', { exact: true })).toBeVisible();
  expect(requests[0].messages.map(message => message.id)).toEqual(['greeting', 'question']);
  expect(requests[0].messages.at(-1).content).toBe('Tell me a story about the moon.');
  await answer.getByRole('button', { name: 'Previous reply' }).click();
  await expect(answer.locator('.message-bubble')).toHaveText('The original story.');
  await answer.getByRole('button', { name: 'Next reply' }).click();
  expect(requests).toHaveLength(1);
  await expect(answer.locator('.message-bubble')).toHaveText('Generated reply 1.');
  await answer.getByRole('button', { name: 'Edit companion message' }).click();
  await page.getByRole('textbox', { name: 'Edit message text' }).fill('My edited alternative.');
  await page.getByRole('button', { name: 'Save edit' }).click();
  await expect(answer.locator('.message-bubble')).toHaveText('My edited alternative.');
  await expect.poll(() => saved().find(message => message.id === 'answer')?.content).toBe('My edited alternative.');
  await page.reload();
  await expect(answer.locator('.message-bubble')).toHaveText('My edited alternative.');
  await expect(answer.getByLabel('Reply 2 of 2', { exact: true })).toBeVisible();

  await page.locator('.composer textarea').fill('Continue the story.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Generated reply 2.', { exact: true })).toBeVisible();
  expect(requests[1].messages.find(message => message.id === 'answer').content).toBe('My edited alternative.');
  await expect.poll(() => saved().length).toBe(5);
  const later = saved().slice(3).map(message => message.id);
  await answer.getByRole('button', { name: 'Regenerate reply', exact: true }).click();
  await expect(answer.locator('.message-bubble')).toHaveText('Generated reply 3.');
  expect(requests[2].messages.map(message => message.id)).toEqual(['greeting', 'question']);
  await expect.poll(() => saved().find(message => message.id === 'answer')?.content).toBe('Generated reply 3.');
  expect(saved().slice(3).map(message => message.id)).toEqual(later);

  const beforeFailure = structuredClone(saved().find(message => message.id === 'answer'));
  test.mode('fail');
  await answer.getByRole('button', { name: 'Regenerate reply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The test provider is unavailable.');
  await expect(answer.locator('.message-bubble')).toHaveText(beforeFailure.content);
  expect(saved().find(message => message.id === 'answer')).toEqual(beforeFailure);

  test.mode('hold');
  await answer.getByRole('button', { name: 'Regenerate reply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  expect(saved().find(message => message.id === 'answer')).toEqual(beforeFailure);
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  test.release();
  await expect(answer.locator('.message-bubble')).toHaveText(beforeFailure.content);
  expect(saved().find(message => message.id === 'answer')).toEqual(beforeFailure);

  // Supply a genuinely incremental response so stopping after visible tokens is
  // also covered, rather than only cancelling before the response begins.
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.__restoreChatFetch = () => { window.fetch = originalFetch; };
    window.fetch = async (input, options) => {
      if (input !== '/api/chat') return originalFetch(input, options);
      const stream = new ReadableStream({ start(controller) {
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"An unfinished alternative."}}]}\n\n'));
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await answer.getByRole('button', { name: 'Regenerate reply', exact: true }).click();
  await expect(answer.locator('.message-bubble')).toHaveText('An unfinished alternative.');
  expect(saved().find(message => message.id === 'answer')).toEqual(beforeFailure);
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(answer.locator('.message-bubble')).toHaveText(beforeFailure.content);
  expect(saved().find(message => message.id === 'answer')).toEqual(beforeFailure);
  await page.evaluate(() => window.__restoreChatFetch());

  test.mode('fail');
  await page.locator('.composer textarea').fill('A question to retry.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate reply', exact: true })).toBeVisible();
  await expect.poll(() => saved().at(-1)?.content).toBe('A question to retry.');
  const userCount = saved().filter(message => message.role === 'user').length;
  test.mode('success');
  await page.getByRole('button', { name: 'Generate reply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect.poll(() => saved().at(-1)?.role).toBe('assistant');
  expect(saved().filter(message => message.role === 'user')).toHaveLength(userCount);
  await page.screenshot({ path: '.sites-runtime/chat-options-desktop.png', fullPage: true, animations: 'disabled' });
  expect(test.errors).toEqual([]);
  await test.context.close();
  console.log('PASS: edit/cancel, saved edits and alternatives, regeneration context, chosen reply in future context, preserved later messages, failure/cancellation rollback, and retry without duplicate user messages.');

  const mobile = await setup(true);
  const bubble = mobile.answer.locator('.message-bubble');
  const cdp = await mobile.context.newCDPSession(mobile.page);
  async function swipe(direction) {
    await bubble.scrollIntoViewIfNeeded();
    const box = await bubble.boundingBox();
    const y = box.y + box.height / 2;
    const from = direction === 'left' ? box.x + box.width * .9 : box.x + box.width * .1;
    const to = direction === 'left' ? box.x + box.width * .1 : box.x + box.width * .9;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y, id: 1 }] });
    for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (to - from) * step / 5, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await swipe('left');
  await expect(bubble).toHaveText('Generated reply 1.');
  await expect(mobile.answer.getByLabel('Reply 2 of 2', { exact: true })).toBeVisible();
  await swipe('right');
  await expect(bubble).toHaveText('The original story.');
  expect(mobile.requests).toHaveLength(1);
  await swipe('left');
  await expect(bubble).toHaveText('Generated reply 1.');
  expect(mobile.requests).toHaveLength(1);
  await swipe('left');
  await expect(bubble).toHaveText('Generated reply 2.');
  await expect(mobile.answer.getByLabel('Reply 3 of 3', { exact: true })).toBeVisible();
  expect(await mobile.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await mobile.page.screenshot({ path: '.sites-runtime/chat-options-mobile.png', fullPage: true, animations: 'disabled' });
  expect(mobile.errors).toEqual([]);
  await mobile.context.close();
  console.log('PASS: real touch swipes generate alternatives at the end and browse saved replies in both directions on mobile.');
} finally { await browser.close(); }
