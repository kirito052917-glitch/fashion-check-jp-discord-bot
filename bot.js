import { chromium } from 'playwright';
import fetch from 'node-fetch';
import fs from 'fs';

/**
 * ===== CONFIG =====
 */
const TARGET_USER = process.env.TEST_USER || '396zack';
const KEYWORD = '80点';
const STORAGE_FILE = './last_tweet.json';

/**
 * ===== TEST MODE =====
 * Set both to null for production
 */
// const TEST_NOW = '2025-12-19T09:37:07.000Z';
const TEST_NOW = null;

// const TEST_TWEET_URL = 'https://x.com/396Zack/status/2001949908199498017';
const TEST_TWEET_URL = null;

console.log(`Target account: @${TARGET_USER}`);

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
  fs.writeFileSync(
    STORAGE_FILE,
    JSON.stringify({ lastTweetId: id }, null, 2)
  );
}

/**
 * ✅ JST DATE WINDOW GUARD (FINAL FIX)
 * Only allow tweets from "today" in JST
 */
function isWithinDateWindow(tweetIsoTime) {
  if (!tweetIsoTime) return false;

  // Convert tweet time to JST
  const tweetDate = new Date(tweetIsoTime);
  const tweetJst = new Date(tweetDate.getTime() + 9 * 60 * 60 * 1000);

  const now = nowDate();
  const nowJst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const start = new Date(`${yyyyMmDd(nowJst)}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86400000);

  return tweetJst >= start && tweetJst < end;
}

/* ---------- X Cookie Login ---------- */

async function loadXCookies(context) {
  if (!process.env.X_COOKIES) {
    console.log('⚠️ No X cookies provided');
    return;
  }

  const cookies = JSON.parse(process.env.X_COOKIES);
  await context.addCookies(cookies);
  console.log('✅ X cookies loaded');
}

/* ---------- Fetch Latest Tweet ---------- */

async function findLatestTweet(page, lastId) {
  // ✅ TEST MODE
  if (TEST_TWEET_URL) {
    console.log('TEST MODE: loading exact tweet');
    await page.goto(TEST_TWEET_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    return await page.$eval('article', a => ({
      link: a.querySelector('a[href*="/status/"]')?.href,
      text: a.innerText,
      time: a.querySelector('time')?.getAttribute('datetime'),
    }));
  }

  // ✅ PRIMARY: SEARCH
  const now = nowDate();
  const since = yyyyMmDd(now);
  const until = yyyyMmDd(new Date(now.getTime() + 86400000));

  const searchUrl =
    `https://x.com/search?q=` +
    encodeURIComponent(
      `from:${TARGET_USER} ${KEYWORD} since:${since} until:${until}`
    ) +
    `&f=live`;

  console.log('Search URL:', searchUrl);

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const searchTweets = await page.$$eval('article', articles =>
    articles.map(a => ({
      link: a.querySelector('a[href*="/status/"]')?.href,
      text: a.innerText,
      time: a.querySelector('time')?.getAttribute('datetime'),
    })).filter(t => t.link)
  );

  if (searchTweets.length > 0) {
    const t = searchTweets[0];

    if (!isWithinDateWindow(t.time)) {
      console.log('Search tweet outside JST date window — ignoring');
      return null;
    }

    return t;
  }

  // ✅ FALLBACK: PROFILE SCAN (FIRST 10)
  console.log('Search empty — scanning profile (first 10 tweets)');
  await page.goto(`https://x.com/${TARGET_USER}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  const profileTweets = await page.$$eval('article', articles =>
    articles.slice(0, 10).map(a => ({
      link: a.querySelector('a[href*="/status/"]')?.href,
      text: a.innerText,
      time: a.querySelector('time')?.getAttribute('datetime'),
    })).filter(t => t.link)
  );

  for (const tweet of profileTweets) {
    const id = extractTweetId(tweet.link);
    if (!id) continue;

    if (!isNewer(id, lastId)) {
      console.log(`Reached processed tweet (${id}) — stopping scan`);
      break;
    }

    if (!isWithinDateWindow(tweet.time)) {
      console.log('Skipping tweet outside JST date window');
      continue;
    }

    if (tweet.text.includes(KEYWORD)) {
      console.log('Found matching tweet via profile fallback');
      return tweet;
    }
  }

  return null;
}

/* ---------- Main ---------- */

async function run() {
  console.log('Bot started');
  console.log('Current time:', nowDate().toISOString());

  const lastId = loadLastTweetId();
  console.log('Last stored tweet ID:', lastId ?? '(none)');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await loadXCookies(context);

  const page = await context.newPage();
  const loggedIn =
    (await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').count()) > 0;

  console.log(loggedIn ? '✅ Logged into X' : '❌ NOT logged into X');

  const tweet = await findLatestTweet(page, lastId);

  if (!tweet?.link) {
    console.log('No valid tweet found');
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
