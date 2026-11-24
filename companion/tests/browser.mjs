import { chromium, expect } from '@playwright/test';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

// Run against an already-running local development server. Restore the initial
// database state and remove this test's uploaded portrait when finished.
const base = process.env.WAFFLE_TEST_URL || 'http://127.0.0.1:5174';
const initial = await (await fetch(base + '/api/state')).json();
if (!initial.data) throw new Error('Open the app once before running the browser flow.');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
const errors = [];
let uploadId;
page.on('pageerror', error => errors.push(error.message));
await mkdir('.sites-runtime', { recursive: true });
try {
  await page.goto(base);
  await expect(page.getByText('Your room is saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /How was your day/ }).click();
  await expect(page.getByText('Scripted demo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Evening glow', exact: true }).click();
  await expect(page.locator('.stage')).toHaveClass(/evening/);
  await page.getByRole('button', { name: 'Send Sakura a little love' }).click();
  await expect(page.getByText('That made my day. ♡', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText('Demo is ready. Replies are scripted and do not use an AI model.')).toBeVisible();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Create companion', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Luna');
  await page.getByLabel('A little introduction', { exact: true }).fill('A cozy friend for late-night ideas');
  await page.getByLabel('Personality', { exact: true }).fill('Curious, Kind, Witty');
  await page.getByLabel('Upload companion portrait', { exact: true }).setInputFiles('public/art/sakura.png');
  await expect(page.getByRole('button', { name: 'Upload portrait', exact: true })).toBeEnabled({ timeout: 15000 });
  uploadId = (await page.getByLabel('Artwork URL', { exact: true }).inputValue()).split('/').pop();
  await page.getByRole('button', { name: 'lavender accent', exact: true }).click();
  await page.getByRole('button', { name: 'Create companion', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'A little time with Luna', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Luna', exact: true }).fill('Hello Luna');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Scripted demo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(page.getByText('Your room is saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A little time with Luna', exact: true })).toBeVisible();
  await expect(page.getByText('Hello Luna', { exact: true })).toBeVisible();
  await expect(page.locator('.character')).toHaveJSProperty('complete', true);
  expect(await page.locator('.character').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Companions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Luna', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Sakura’s room', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Sakura', exact: true }).fill('Tell me a story');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Chat provider', { exact: true }).selectOption('openrouter');
  await page.getByLabel('OpenRouter API key', { exact: true }).fill('browser-test-key-not-a-real-key');
  await page.getByLabel('Chat model', { exact: true }).fill('test/model');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Your room is saved', { exact: true })).toBeVisible();
  const saved = await (await fetch(base + '/api/state')).text();
  expect(saved).not.toContain('browser-test-key-not-a-real-key');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('OpenRouter API key', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
  console.log('PASS: demo chat, cancellation, room controls, settings, portrait upload, companion creation/switching, SQLite reload, and tab-only keys.');
} finally {
  await browser.close();
  await fetch(base + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(initial.data) });
  if (uploadId && /^[a-f0-9-]{36}\.png$/.test(uploadId)) {
    for (const owner of await readdir('.data/art')) await rm(path.join('.data/art', owner, uploadId), { force: true });
  }
}

const screenshots = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
    const tab = await screenshots.newPage({ viewport });
    await tab.goto(base);
    await expect(tab.getByText('Your room is saved', { exact: true })).toBeAttached();
    expect(await tab.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await tab.screenshot({ path: `.sites-runtime/${name}.png`, fullPage: true });
    await tab.close();
  }
  console.log('PASS: desktop and mobile layouts have no horizontal overflow.');
} finally { await screenshots.close(); }
