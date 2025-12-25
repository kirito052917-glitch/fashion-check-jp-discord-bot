import { chromium } from 'playwright';
import fetch from 'node-fetch';

/**
 * ===== TEST MODE =====
 * Set TEST_NOW to an ISO timestamp to simulate "current time"
 * Set to null for production
 */
const TEST_NOW = '2025-12-19T09:37:07.000Z';
// const TEST_NOW = null;

const TARGET_USER = '396zack';
const KEYWORD = '80点';

// Safety: never post tweets older than this many days
const MAX_TWEET_AGE_DAYS = 2;

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

function isRecentEnough(isoDate, maxDays) {
  const tweet = new Date(isoDate);
  const now = nowDate();
  return now - tweet <= maxDays * 86400000;
}

async function run() {
  console.log('Bot started');
  console.log('Current time:', nowDate().toISOString());

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '      +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  await page.goto(`https://x.com/${TARGET_USER}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Allow timeline to load
  await page.waitForTimeout(5000);

  // Scroll to load non-pinned tweets
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(3000);
  }

  const tweets = await page.$$eval('article', articles =>
    articles
      // ❌ Remove pinned tweets
      .filter(a => !a.querySelector('svg[aria-label="Pinned"]'))
      .map(a => {
        const timeEl = a.querySelector('time');
        const linkEl = a.querySelector('a[href*="/status/"]');

        return {
          text: a.innerText,
          link: linkEl ? `https://x.com${linkEl.getAttribute('href')}` : null,
          time: timeEl ? timeEl.getAttribute('datetime') : null,
        };
      })
      .filter(t => t.link && t.time)
  );

  console.log(`Found ${tweets.length} timeline tweets`);

  let posted = 0;

  for (const tweet of tweets) {
    const ageHours = ((nowDate() - new Date(tweet.time)) / 36e5).toFixed(1);

    console.log('---');
    console.log('Tweet time:', tweet.time);
    console.log('Age (hours):', ageHours);
    console.log('Same UTC day?', isSameUTCDate(tweet.time));
    console.log('Contains keyword?', tweet.text.includes(KEYWORD));

    if (!isRecentEnough(tweet.time, MAX_TWEET_AGE_DAYS)) {
      console.log('Skipped: too old');
      continue;
    }

    if (!isSameUTCDate(tweet.time)) {
      console.log('Skipped: wrong date');
      continue;
    }

    if (!tweet.text.includes(KEYWORD)) {
      console.log('Skipped: keyword not found');
      continue;
    }

    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tweet.link }),
    });

    console.log('✅ Posted to Discord, status:', res.status);
    posted++;
  }

  if (posted === 0) {
    console.log('No matching tweets posted');
  }

  await browser.close();
  console.log('Bot finished');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
