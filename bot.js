import { chromium } from 'playwright';
import fetch from 'node-fetch';

const TARGET_USER = '396zack';
const KEYWORD = '80点';

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

function isTodayUTC(isoDate) {
  const tweetDate = new Date(isoDate);
  const now = new Date();

  return (
    tweetDate.getUTCFullYear() === now.getUTCFullYear() &&
    tweetDate.getUTCMonth() === now.getUTCMonth() &&
    tweetDate.getUTCDate() === now.getUTCDate()
  );
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`https://x.com/${TARGET_USER}`, {
    waitUntil: 'networkidle'
  });

  const tweets = await page.$$eval('article', articles =>
    articles.map(a => {
      const timeEl = a.querySelector('time');
      const linkEl = a.querySelector('a[href*="/status/"]');

      return {
        text: a.innerText,
        link: linkEl ? `https://x.com${linkEl.getAttribute('href')}` : null,
        time: timeEl ? timeEl.getAttribute('datetime') : null
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
      body: JSON.stringify({ content: tweet.link })
    });
  }
}

run();
