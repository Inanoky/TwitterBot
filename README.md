# AI Construction News Bot for X (Twitter)

A full Next.js + Vercel Cron app that posts **every hour** to X with engaging updates about AI trends in construction (AEC, infrastructure, jobsite automation, robotics, etc.).

## Features

- Runs on **Vercel Cron** (`0 */1 * * *`) for posting plus a second cron for engagement replies
- Fetches latest stories from **NewsAPI** and/or **GNews**
- Pulls Google Trends signals to prioritize topics with broader momentum
- Lets the configured latest OpenAI model (default `gpt-5.1`) choose the most engaging AI+construction topic before posting
- Filters and sorts for fresh AI+construction content
- Avoids duplicate post sources using **Vercel KV** (optional but recommended)
- Generates compelling post copy with **OpenAI** (fallback generator if OpenAI key is missing)
- Grows the account more safely by liking relevant niche posts and optionally following strong-fit creators via a dedicated cron route
- Starts every post with a hook and includes the source URL in the same tweet while staying within X character limits
- Attaches a relevant image from **Pexels** when `PEXELS_API` is configured
- Publishes directly to X using OAuth 1.0a user context

---

## 1) Prerequisites

- Node.js 18+
- A Vercel account
- X developer app + user tokens
- At least one news API provider account:
  - NewsAPI (`NEWS_API_KEY`)
  - GNews (`GNEWS_API_KEY`)

Recommended:
- OpenAI API key for better post quality
- Vercel KV for durable duplicate tracking

---

## 2) Install locally

```bash
npm install
cp .env.example .env.local
```

Populate `.env.local` with your credentials.

Run:

```bash
npm run dev
```

The home page is available at:

- `http://localhost:3000`

Manual cron test (with auth header):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/post
```

---

## 3) API setup guidance

### A) X/Twitter API credentials (important)

Based on your screenshot, you currently have an **OAuth 1.0 Access Token with `Read` only**. That cannot post tweets.

To fix this in X Developer Portal:

1. Open your App → **User authentication settings** → **Set up**.
2. Set **App permissions** to **Read and write**.
3. Save settings.
4. Go back to **OAuth 1.0 Keys** and click **Regenerate** for:
   - Consumer Key/Secret (if needed)
   - Access Token/Secret
5. Confirm the access token now shows **Read and write** (not only Read).

Then set:

- `TWITTER_API_KEY` (Consumer Key)
- `TWITTER_API_SECRET` (Consumer Secret)
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`

> Note: **App-Only Bearer Token** cannot create tweets for this app flow, but you should still add `TWITTER_BEARER_TOKEN` because the engagement cron uses X recent search to discover relevant posts.

The app posts via:

- `POST https://api.twitter.com/2/tweets`

### B) News provider keys

Use one or both:

- `NEWS_API_KEY` from https://newsapi.org
- `GNEWS_API_KEY` from https://gnews.io

If both are configured, the bot merges and deduplicates results.

### C) OpenAI (optional but recommended)

- `OPENAI_API_KEY`
- Optional: `OPENAI_MODEL` (defaults to `gpt-5.1`)
- `PEXELS_API` for article-adjacent construction imagery

If set, the app uses the configured OpenAI model to:
- choose the most engaging topic from news + Google Trends signals
- generate the main post copy

If absent, it falls back to templated writing. When `PEXELS_API` is set, the bot also fetches a landscape image and uploads it with the main tweet.

### D) Vercel KV (recommended for no duplicates)

Provision Vercel KV and set:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Without KV, deduplication won’t persist across runs/deployments.

### E) Cron route security

Set:

- `CRON_SECRET`

Vercel cron should send:

- `Authorization: Bearer <CRON_SECRET>`

---

## 4) Deploy to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. Import project into Vercel.
3. Add all environment variables in **Project Settings → Environment Variables**.
4. Deploy.

Cron is configured in `vercel.json` and currently posts hourly while the engagement cron runs hourly.

---

## 5) Project structure

- `app/api/cron/post/route.ts` - scheduled endpoint; fetches news, ranks stories using Google Trends overlap, generates copy with source link inline, and posts to X.
- `app/api/cron/engage/route.ts` - scheduled endpoint; finds relevant X posts, likes one strong-fit post, posts one AI-generated quote-post, and optionally follows the author on each run.
- `lib/news.ts` - news providers + query + dedupe/sort.
- `lib/post-generator.ts` - hook-first OpenAI prompt + fallback generator.
- `lib/pexels.ts` - fetches a relevant construction image from Pexels.
- `lib/twitter.ts` - OAuth 1.0a signing + X post publish, reply, and media upload.
- `lib/dedup.ts` - KV-based URL dedupe tracking.
- `vercel.json` - cron schedule.

---

## 6) Notes on reliability & quality

- The posting cron now ranks fresh unposted stories using both news recency and Google Trends overlap.
- The growth cron uses likes + one AI quote-post per run, then optionally follows selective authors to build visibility more safely.
- Writing is constrained for practical and engaging B2B tone, with room for a natural discussion prompt when useful.
- Add additional providers or ranking logic if you want richer source diversity.
- If no fresh story exists, the cron run exits cleanly without posting.

