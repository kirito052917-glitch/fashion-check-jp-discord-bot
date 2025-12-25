import { chromium } from 'playwright';
import fetch from 'node-fetch';

// ===== TEST MODE =====
// Uncomment TEST_DATE to simulate "today" for testing
const TEST_DATE = '2025-12-19'; // YYYY-MM-DD

const TARGET_USER = '396zack';
const KEYWORD = '80点';

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

function isTodayUTC(isoDate) {
  const tweetDate = new Date(isoDate);

  // Use test date if provided
  const now = typeof TEST_DATE !== 'undefined'
    ? new Date(`${TEST_DATE}T00:00:00Z`)
    : new Date();

  return (
    tweetDate.getUTCFullYear() === now.getUTCFullYear() &&
    tweetDate.getUTCMonth() === now.getUTCMonth() &&
    tweetDate.getUTCDate() === now.getUTCDate()
  );
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  await page.goto(`https://x.com/${TARGET_USER}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // small delay to allow tweets to render
  await page.waitForTimeout(5000);

  const tweets = await page.$$eval('article', articles =>
    articles.map(a => {
      const timeEl = a.querySelector('time');
      const linkEl = a.querySelector('a[href*="/status/"]');

      return {
        text: a.innerText,
        link: linkEl ? `https://x.com${linkEl.getAttribute('href')}` : null,
        time: timeEl ? timeEl.getAttribute('datetime') : null,
      };
    }).filter(t => t.link && t.time)
  );

  await browser.close();

  for (const tweet of tweets) {
    if (!isTodayUTC(tweet.time)) continue;
    if (!tweet.text.includes(KEYWORD)) continue;

    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tweet.link }),
    });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
