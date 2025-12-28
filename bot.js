async function findLatestTweet(page, { targetUser, keyword }, lastId) {
  // ---------- TEST MODE ----------
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

  // ---------- SEARCH ----------
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

    if (!isNewer(id, lastId)) {
      console.log(`Search reached processed tweet (${id}) — skipping`);
      continue;
    }

    if (keyword && !isWithinDateWindow(tweet.time)) {
      console.log('Search tweet outside JST date window — skipping');
      continue;
    }

    console.log('Found NEW tweet via search');
    return tweet;
  }

  // ---------- PROFILE FALLBACK ----------
  console.log('Search empty — scanning profile (first 15 tweets)');
  await page.goto(`https://x.com/${targetUser}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  const profileTweets = await page.$$eval('article', articles =>
    articles
      // Remove pinned tweets (EN + JP)
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

    if (!isNewer(id, lastId)) {
      console.log(`Profile reached processed tweet (${id}) — stopping scan`);
      break;
    }

    if (keyword && !isWithinDateWindow(tweet.time)) {
      console.log('Profile tweet outside JST date window — skipping');
      continue;
    }

    console.log('Found NEW tweet via profile');
    return tweet;
  }

  return null;
}

/* ---------- Main ---------- */

async function run() {
  console.log('Bot started');
  console.log('Current time:', nowDate().toISOString());

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await loadXCookies(context);

  const page = await context.newPage();
  const loggedIn =
    (await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').count()) > 0;

  console.log(loggedIn ? '✅ Logged into X' : '❌ NOT logged into X');

  // OPTIONAL SAFETY (recommended)
  if (!loggedIn) {
    console.log('❌ Not logged into X — aborting to prevent duplicate posts');
    await browser.close();
    return;
  }

  for (const bot of BOTS) {
    console.log(`\n🤖 Running ${bot.name}`);
    console.log(`Target account: @${bot.targetUser}`);

    if (!bot.webhook) {
      console.log('⚠️ Webhook not set — skipping');
      continue;
    }

    const lastId = loadLastTweetId(bot.storageFile);
    console.log('Last stored tweet ID:', lastId ?? '(none)');

    const tweet = await findLatestTweet(
      page,
      { targetUser: bot.targetUser, keyword: bot.keyword },
      lastId
    );

    if (!tweet?.link) {
      console.log('No valid new tweet found');
      continue;
    }

    const tweetId = extractTweetId(tweet.link);
    console.log('Latest tweet ID:', tweetId);

    if (!isNewer(tweetId, lastId)) {
      console.log('Tweet already processed — skipping');
      continue;
    }

    const res = await fetch(bot.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tweet.link }),
    });

    console.log('✅ Posted to Discord:', res.status);

    saveLastTweetId(bot.storageFile, tweetId);
    console.log('Saved new tweet ID');
  }

  await browser.close();
  console.log('\n✅ All bots finished');
}

/* ---------- Run ---------- */

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
