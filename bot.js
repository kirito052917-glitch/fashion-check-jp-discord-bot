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

/* ---------- Run ---------- */

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
