import { chromium } from 'playwright';
import fetch from 'node-fetch';
import fs from 'fs';

/* ---------- CONFIG ---------- */

const BOTS = [
  {
    name: 'Score Bot',
    targetUser: process.env.TEST_USER || '396zack',
    keyword: '80点',
    storageFile: './last_tweet_396zack.json',
    webhook: process.env.DISCORD_WEBHOOK,
  },
  {
    name: 'Doma Castle Bot',
    targetUser: 'domacastleffxiv',
    keyword: null,
    storageFile: './last_tweet_domacastle.json',
    webhook: process.env.DISCORD_WEBHOOK_DOMA,
  },
];

// TEST MODE (keep null in production)
const TEST_NOW = null;
const TEST_TWEET_URL = null;

/* ---------- HELPERS ---------- */

function nowDate() {
  return TEST_NOW ? new Date(TEST_NOW) : new Date();
}

function yyyyMmDd(date) {
  return date.toISOString().slice(0, 10);
}

function extractTweetId(url) {
  return url?.split('/status/')[1]?.split('?')[0] ?? null;
}

function isNewer(id, lastId) {
  if (!id) return false;
  if (!lastId) return true;
  return BigInt(id) > BigInt(lastId);
}

function loadLastTweetId(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).lastTweetId ?? null;
  } catch {
    return null;
  }
}

function saveLastTweetId(file, id) {
  fs.writeFileSync(
    file,
    JSON.stringify({ lastTweetId: id }, null, 2)
  );
}

/**
 * JST date guard (ONLY for keyword bots)
 */
function isWithinDateWindow(tweetIsoTime) {
  if (!tweetIsoTime) return false;

  const tweetDate = new Date(tweetIsoTime);
  const tweetJst = new Date(tweetDate.getTime() + 9 * 60 * 60 * 1000);

  const now = nowDate();
  const nowJst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const start = new Date(`${yyyyMmDd(nowJst)}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86400000);

  return tweetJst >= start && tweetJst < end;
}

/* ---------- X COOKIE LOGIN ---------- */

async function loadXCookies(context) {
  if (!process.env.X_COOKIES) {
    console.log('⚠️ No X cookies provided');
    return;
  }

  const cookies = JSON.parse(process.env.X_COOKIES);
  await context.addCookies(cookies);
  console.log('✅ X cookies loaded');
}

/* ---------- FIND LATEST TWEET ---------- */

async function findLatestTweet(page, { targetUser, keyword }, lastId) {
  // TEST MODE
  if (TEST_TWEET_URL) {
    await page.goto(TEST_TWEET_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    return await page.$eval('article', a => ({
      link: a.querySelector('a[href*="/status/"]')?.href,
      text: a.innerText,
      time: a.querySelector('time')?.getAttribute('datetime'),
    }));
  }

  // SEARCH
  const now = nowDate();
  const since = yyyyMmDd(now);
  const until = yyyyMmDd(new Date(now.getTime() + 86400000));

  const query = keyword
    ? `from:${targetUser} ${keyword} since:${since} until:${until}`
    : `from:${targetUser}`;

  const searchUrl =
    `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;

  console.log('Search URL:', searchUrl);

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const searchTweets = await page.$$eval('article', articles =>
    articles
      .map(a => ({
        link: a.querySelector('a[href*="/status/"]')?.href,
        text: a.innerText,
        time: a.querySelector('time')?.getAttribute('datetime'),
      }))
      .filter(t => t.link)
  );

  for (const tweet of searchTweets) {
    const id = extractTweetId(tweet.link);
    if (!id) continue;

    if (!isNewer(id, lastId)) continue;

    if (keyword && !isWithinDateWindow(tweet.time)) continue;

    console.log('Found NEW tweet via search');
    return tweet;
  }

  // PROFILE FALLBACK
  console.log('Search empty — scanning profile');
  await page.goto(`https://x.com/${targetUser}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  const profileTweets = await page.$$eval('article', articles =>
    articles
      .filter(a =>
        !a.innerText.includes('Pinned') &&
        !a.innerText.includes('固定')
      )
      .slice(0, 15)
      .map(a => ({
        link: a.querySelector('a[href*="/status/"]')?.href,
        text: a.innerText,
        time: a.querySelector('time')?.getAttribute('datetime'),
      }))
      .filter(t => t.link)
  );

  for (const tweet of profileTweets) {
    const id = extractTweetId(tweet.link);
    if (!id) continue;

    if (!isNewer(id, lastId)) break;

    if (keyword && !isWithinDateWindow(tweet.time)) continue;

    console.log('Found NEW tweet via profile');
    return tweet;
  }

  return null;
}

/* ---------- MAIN ---------- */

async function run() {
  console.log('Bot started');
  console.log('Current time:', nowDate().toISOString());

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await loadXCookies(context);

  const page = await context.newPage();

  console.log('✅ Proceeding without UI login check (cookie-based auth)');

  for (const bot of BOTS) {
    console.log(`\n🤖 Running ${bot.name}`);
    console.log(`Target: @${bot.targetUser}`);

    if (!bot.webhook) continue;

    const lastId = loadLastTweetId(bot.storageFile);
    console.log('Last stored ID:', lastId ?? '(none)');

    const tweet = await findLatestTweet(
      page,
      { targetUser: bot.targetUser, keyword: bot.keyword },
      lastId
    );

    if (!tweet?.link) {
      console.log('No new tweet found');
      continue;
    }

    const tweetId = extractTweetId(tweet.link);
    if (!isNewer(tweetId, lastId)) continue;

    await fetch(bot.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tweet.link }),
    });

    console.log('✅ Posted:', tweet.link);
    saveLastTweetId(bot.storageFile, tweetId);
  }

  await browser.close();
  console.log('\n✅ All bots finished');
}

/* ---------- RUN ---------- */

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
