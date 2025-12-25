import { chromium } from 'playwright';
import fetch from 'node-fetch';
import fs from 'fs';

/**
 * ===== CONFIG =====
 */
const TARGET_USER = '396zack';
const KEYWORD = '80点';
const STORAGE_FILE = './last_tweet.json';

/**
 * ===== TEST MODE =====
 * Set TEST_NOW to simulate current time
 * Set TEST_TWEET_URL to force-test a known tweet
 * Set both to null for production
 */
const TEST_NOW = '2025-12-19T09:37:07.000Z';
// const TEST_NOW = null;

const TEST_TWEET_URL = null;
const TEST_TWEET_URL = 'https://x.com/396Zack/status/2001949908199498017';

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

if (!DISCORD_WEBHOOK) {
  console.error('DISCORD_WEBHOOK is not set');
  process.exit(1);
}

/* ---------- Helpers ---------- */

function nowDate() {
  return TEST_NOW ? new Date(TEST_NOW) : new Date();
}

function yyyyMmDd(date) {
  return date.toISOString().slice(0, 10);
}

function extractTweetId(url) {
  return url.split('/status/')[1]?.split('?')[0];
}

function isNewer(id, lastId) {
  if (!lastId) return true;
  return BigInt(id) > BigInt(lastId);
}

function loadLastTweetId() {
  if (!fs.existsSync(STORAGE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STORAGE_FILE)).lastTweetId;
}

function saveLastTweetId(id) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify({ lastTweetId: id }, null, 2));
}

/* ---------- Fetch Latest Tweet ---------- */

async function findLatestTweet(page) {
  // ✅ TEST MODE: load exact tweet
  if (TEST_TWEET_URL) {
    console.log('TEST MODE: loading exact tweet');
    await page.goto(TEST_TWEET_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const tweet = await page.$eval('article', a => {
      const link = a.querySelector('a[href*="/status/"]')?.href;
      return { link, text: a.innerText };
    });

    return tweet;
  }

  // ✅ Primary: SEARCH (chronological)
  const now = nowDate();
  const since = yyyyMmDd(now);
  const until = yyyyMmDd(new Date(now.getTime() + 86400000));

  const searchUrl =
    `https://x.com/search?q=` +
    encodeURIComponent(`from:${TARGET_USER} ${KEYWORD} since:${since} until:${until}`) +
    `&f=live`;

  console.log('Search URL:', searchUrl);

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const tweets = await page.$$eval('article', articles =>
    articles.map(a => {
      const link = a.querySelector('a[href*="/status/"]')?.href;
      return { link, text: a.innerText };
    }).filter(t => t.link)
  );

  if (tweets.length > 0) {
    console.log('Found tweet via search');
    return tweets[0];
  }

  // ✅ Fallback: load ONLY top tweet from profile
  console.log('Search empty, falling back to profile');
  await page.goto(`https://x.com/${TARGET_USER}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  return await page.$eval('article', a => {
    const link = a.querySelector('a[href*="/status/"]')?.href;
    return { link, text: a.innerText };
  });
}

/* ---------- Main ---------- */

async function run() {
  console.log('Bot started');
  console.log('Current time:', nowDate().toISOString());

  const lastId = loadLastTweetId();
  console.log('Last stored tweet ID:', lastId ?? '(none)');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const tweet = await findLatestTweet(page);

  if (!tweet?.link) {
    console.log('No tweet found');
    await browser.close();
    return;
  }

  const tweetId = extractTweetId(tweet.link);
  console.log('Latest tweet ID:', tweetId);

  if (!isNewer(tweetId, lastId)) {
    console.log('Tweet already processed — skipping');
    await browser.close();
    return;
  }

  if (!tweet.text.includes(KEYWORD)) {
    console.log('Keyword not found — skipping');
    await browser.close();
    return;
  }

  const res = await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: tweet.link }),
  });

  console.log('✅ Posted to Discord:', res.status);

  saveLastTweetId(tweetId);
  console.log('Saved new tweet ID');

  await browser.close();
  console.log('Bot finished');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
