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

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

if (!DISCORD_WEBHOOK) {
  console.error('DISCORD_WEBHOOK is not set');
  process.exit(1);
}

/* ---------- Time helpers ---------- */

function nowDate() {
  return TEST_NOW ? new Date(TEST_NOW) : new Date();
}

function yyyyMmDd(date) {
  return date.toISOString().slice(0, 10);
}

/* ---------- Main ---------- */

async function run() {
  const now = nowDate();

  const since = yyyyMmDd(now);
  const until = yyyyMmDd(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  console.log('Bot started');
  console.log('Current time:', now.toISOString());
  console.log(`Search window: ${since} → ${until}`);

  const searchUrl =
    `https://x.com/search?q=` +
    encodeURIComponent(`from:${TARGET_USER} ${KEYWORD} since:${since} until:${until}`) +
    `&f=live`;

  console.log('Search URL:', searchUrl);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Allow search results to load
  await page.waitForTimeout(5000);

  const tweets = await page.$$eval('article', articles =>
    articles
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

  console.log(`Found ${tweets.length} matching tweets`);

  let posted = 0;

  for (const tweet of tweets) {
    console.log('---');
    console.log('Tweet time:', tweet.time);
    console.log('Contains keyword?', tweet.text.includes(KEYWORD));

    if (!tweet.text.includes(KEYWORD)) continue;

    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tweet.link }),
    });

    console.log('✅ Posted to Discord, status:', res.status);
    posted++;
  }

  if (posted === 0) {
    console.log('No tweets posted');
  }

  await browser.close();
  console.log('Bot finished');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
