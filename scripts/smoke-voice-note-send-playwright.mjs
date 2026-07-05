#!/usr/bin/env node
import { chromium } from 'playwright';

const baseUrl = process.env.IRIS_DASHBOARD_URL || 'http://localhost:3317/?preview=1';
const channel = process.env.IRIS_VOICE_NOTE_CHANNEL || 'SMS';
const sendLive = ['1', 'true', 'yes'].includes(String(process.env.SEND_VOICE_NOTE || '').toLowerCase());
const scriptText = process.env.IRIS_VOICE_NOTE_TEXT || `Iris QA ${channel} voice-note test ${new Date().toISOString()}. Reply not needed.`;
const out = process.env.IRIS_VOICE_NOTE_SCREENSHOT || `/tmp/iris-${channel.toLowerCase()}-voice-note-smoke.png`;

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.setDefaultTimeout(30_000);
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.iris-redesign-shell', { timeout: 60_000 });
await page.locator('.iris-nav-list button').filter({ hasText: channel }).first().click().catch(() => {});
await page.waitForTimeout(800);
await page.locator('.iris-composer-actions').getByRole('button', { name: /^Voice note$/ }).click();
await page.locator('.iris-voice-tools textarea').fill(scriptText);
await page.getByRole('button', { name: /Generate voice note/i }).click();
await page.waitForSelector('.iris-attachment-row', { timeout: 90_000 });
if (sendLive) {
  await page.getByRole('button', { name: /Send reply/i }).click();
  await page.waitForSelector('.iris-composer-status', { timeout: 90_000 });
} else {
  await page.getByRole('button', { name: /Preview voice/i }).click();
  await page.waitForSelector('.iris-voice-preview audio', { timeout: 90_000 });
  const playable = await page.locator('.iris-voice-preview audio').evaluate(async (audio) => {
    audio.muted = true;
    await audio.play();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const ok = !audio.paused && audio.currentTime >= 0;
    audio.pause();
    return ok;
  });
  if (!playable) throw new Error('Voice preview did not play');
}
await page.screenshot({ path: out, fullPage: false });
console.log(JSON.stringify({ ok: true, channel, sendLive, screenshot: out }));
await browser.close();
