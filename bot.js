import { chromium } from 'playwright';
import fetch from 'node-fetch';

/**
 * ===== TEST MODE =====
 * Set TEST_NOW to simulate "current time"
 * Set to null for production
 */
const TEST_NOW = '2025-12-19T09:37:07.000Z';
// const TEST_NOW = null;

/**
 * ✅ EXACT TWEET URL
 * Example:
 * https://x.com/396zack/status/1234567890123456789
 */
const TWEET_URL = 'https://x.com/396Zack/status/2001949908199498017?s=20';

const KEYWORD = '80点';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

if (!DISCORD_WEBHOOK) {
  console.error('DISCORD_WEBHOOK is not set');
  process.exit(1);
}

function nowDate() {
  return TEST_NOW ? new Date(TEST_NOW) : new Date();
}

function isSameUTCDate(isoDate) {
  const tweet = new Date(isoDate);
  const now = nowDate();

  return (
    tweet.getUTCFullYear() === now.getUTCFullYear() &&
    tweet.getUTCMonth() === now.getUTCMonth() &&
    tweet.getUTCDate() === now.getUTCDate()
  );
}

async function run() {
  console.log('Bot started');
  console.log('Current time:', nowDate().toISOString());
  console.log('Loading tweet:', TWEET_URL);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  await page.goto(TWEET_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Give X time to hydrate the tweet
  await page.waitForTimeout(5000);

  const tweet = await page.$eval('article', a => {
    const timeEl = a.querySelector('time');
    return {
      text: a.innerText,
      time: timeEl ? timeEl.getAttribute('datetime') : null,
    };
  });

  console.log('Tweet time:', tweet.time);
  console.log('Same UTC day?', isSameUTCDate(tweet.time));
  console.log('Contains keyword?', tweet.text.includes(KEYWORD));

  if (!tweet.time) {
    console.log('❌ Could not read tweet timestamp');
    await browser.close();
    return;
  }

  if (!isSameUTCDate(tweet.time)) {
    console.log('❌ Tweet is not from today');
    await browser.close();
    return;
  }

  if (!tweet.text.includes(KEYWORD)) {
    console.log('❌ Keyword not found');
    await browser.close();
    return;
  }

  const res = await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: TWEET_URL }),
  });

  console.log('✅ Posted to Discord, status:', res.status);

  await browser.close();
  console.log('Bot finished');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
