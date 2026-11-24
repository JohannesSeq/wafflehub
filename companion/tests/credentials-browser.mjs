import { chromium, expect } from '@playwright/test';

// Credentials and room data are mocked; this never writes test keys to the
// real local key file or sends requests to a model/voice provider.
const base = process.env.WAFFLE_TEST_URL || 'http://127.0.0.1:6767';
const initial = (await (await fetch(`${base}/api/state`)).json()).data;
const browser = await chromium.launch({ headless: true });
const routerKey = 'browser-router-test-only';
const voiceKey = 'browser-voice-test-only';
async function setup(local) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  let room = structuredClone(initial);
  room.settings = { ...room.settings, provider: 'demo', voice: 'off', sound: false };
  const saved = {};
  const patches = [];
  const requests = [];
  let fail = false;
  const status = () => ({ local, keyStorage: local, stored: { openrouter: !!saved.openrouter, elevenlabs: !!saved.elevenlabs }, configured: { openrouter: !!saved.openrouter, elevenlabs: !!saved.elevenlabs } });
  await context.route('**/api/state', async route => {
    if (route.request().method() === 'PUT') { room = route.request().postDataJSON(); await route.fulfill({ json: { saved: true } }); }
    else await route.fulfill({ json: { data: room } });
  });
  await context.route('**/api/health', route => route.fulfill({ json: status() }));
  await context.route('**/api/keys', async route => {
    if (fail) { await route.fulfill({ status: 500, json: { error: 'Test storage write failed.' } }); return; }
    const patch = route.request().postDataJSON(); patches.push(patch);
    for (const [name, value] of Object.entries(patch)) { if (value === null) delete saved[name]; else saved[name] = value; }
    await route.fulfill({ json: status() });
  });
  await context.route('**/api/models', async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ json: { models: [{ id: 'test/model', name: 'Test model' }] } }); });
  await page.goto(base);
  await expect(page.getByRole('button', { name: /Switch to (light|dark) mode/ })).toBeEnabled();
  return { context, page, saved, patches, requests, room: () => room, fail: value => { fail = value; } };
}
try {
  const test = await setup(true);
  const { page, saved, patches } = test;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Chat provider', { exact: true }).selectOption('openrouter');
  await page.getByLabel('Chat model', { exact: true }).fill('test/model');
  await page.getByLabel('OpenRouter API key', { exact: true }).fill(routerKey);
  await page.getByLabel('Voice provider', { exact: true }).selectOption('elevenlabs');
  await page.getByLabel('ElevenLabs API key', { exact: true }).fill(voiceKey);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(saved).toEqual({ openrouter: routerKey, elevenlabs: voiceKey });
  await expect.poll(() => test.room().settings.provider).toBe('openrouter');
  expect(JSON.stringify(test.room())).not.toContain(routerKey);
  expect(JSON.stringify(test.room())).not.toContain(voiceKey);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(routerKey);
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('OpenRouter API key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('OpenRouter API key', { exact: true })).toHaveAttribute('placeholder', 'Saved on this computer');
  await expect(page.getByLabel('ElevenLabs API key', { exact: true })).toHaveAttribute('placeholder', 'Saved on this computer');
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText('Connected. 1 model available.', { exact: true })).toBeVisible();
  expect(test.requests.at(-1).key).toBe('');

  // Saving unrelated preferences with empty fields must keep both saved keys.
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(patches).toHaveLength(1);
  expect(saved).toEqual({ openrouter: routerKey, elevenlabs: voiceKey });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('OpenRouter API key', { exact: true }).fill('replacement-router-test');
  test.fail(true);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Test storage write failed.');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(saved.openrouter).toBe(routerKey);
  test.fail(false);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(saved.openrouter).toBe('replacement-router-test');
  expect(saved.elevenlabs).toBe(voiceKey);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Remove saved OpenRouter key' }).click();
  await expect(page.getByLabel('OpenRouter API key', { exact: true })).toHaveAttribute('placeholder', 'sk-or-…');
  expect(saved.openrouter).toBeUndefined(); expect(saved.elevenlabs).toBe(voiceKey);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove saved OpenRouter key' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove saved ElevenLabs key' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await test.context.close();
  console.log('PASS: local key save, refresh without re-entry, empty-field preservation, replacement/removal, failure recovery, no keys in browser storage or room records, and mobile layout.');

  const hosted = await setup(false);
  await hosted.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await hosted.page.getByLabel('Chat provider', { exact: true }).selectOption('openrouter');
  await hosted.page.getByLabel('Chat model', { exact: true }).fill('test/model');
  await hosted.page.getByLabel('OpenRouter API key', { exact: true }).fill(routerKey);
  await hosted.page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(hosted.page.getByRole('dialog')).toHaveCount(0);
  expect(hosted.patches).toHaveLength(0);
  await expect.poll(() => hosted.room().settings.provider).toBe('openrouter');
  await hosted.page.reload(); await hosted.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(hosted.page.getByLabel('OpenRouter API key', { exact: true })).toHaveValue('');
  await expect(hosted.page.getByText('Kept in this tab’s memory. You’ll need to re-enter it after a refresh.', { exact: true })).toBeVisible();
  await hosted.context.close();
  console.log('PASS: hosted mode keeps keys temporary and never invokes local filesystem storage.');
} finally { await browser.close(); }
