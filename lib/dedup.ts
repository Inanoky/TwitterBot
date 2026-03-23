const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const POSTED_SET_KEY = "xbot:posted_story_urls";
const USED_PEXELS_SET_KEY = "xbot:used_pexels_photo_ids";
const ENGAGED_TWEETS_SET_KEY = "xbot:engaged_tweet_ids";
const MAX_TRACKED_URLS = 500;

function hasKvConfig() {
  return Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
}

async function kvCommand(command: string[]) {
  if (!hasKvConfig()) {
    throw new Error("Vercel KV is not configured.");
  }

  const commandPath = command.map(encodeURIComponent).join("/");
  const endpoint = new URL(`${commandPath}`, `${KV_REST_API_URL}/`);

  console.log("[xbot][kv] command", { op: command[0], endpoint: endpoint.toString() });

  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`
    },
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`KV command failed (${command.join(" ")}): ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function trimSetIfNeeded(setKey: string): Promise<void> {
  const size = await kvCommand(["SCARD", setKey]);
  if ((size.result ?? 0) > MAX_TRACKED_URLS) {
    const oldMembers = await kvCommand(["SRANDMEMBER", setKey, "100"]);
    const members: string[] = oldMembers.result ?? [];

    if (members.length > 0) {
      await kvCommand(["SREM", setKey, ...members.slice(0, 50)]);
    }
  }
}

export async function wasStoryPosted(url: string): Promise<boolean> {
  if (!hasKvConfig()) {
    console.log("[xbot][kv] dedup disabled (missing KV config)");
    return false;
  }

  const data = await kvCommand(["SISMEMBER", POSTED_SET_KEY, url]);
  return data.result === 1;
}

export async function markStoryAsPosted(url: string): Promise<void> {
  if (!hasKvConfig()) {
    console.log("[xbot][kv] skip mark (missing KV config)");
    return;
  }

  await kvCommand(["SADD", POSTED_SET_KEY, url]);
  await trimSetIfNeeded(POSTED_SET_KEY);
}

export function isKvEnabled(): boolean {
  return hasKvConfig();
}

export async function wasPexelsPhotoUsed(photoId: string): Promise<boolean> {
  if (!hasKvConfig()) return false;
  const data = await kvCommand(["SISMEMBER", USED_PEXELS_SET_KEY, photoId]);
  return data.result === 1;
}

export async function markPexelsPhotoUsed(photoId: string): Promise<void> {
  if (!hasKvConfig()) return;
  await kvCommand(["SADD", USED_PEXELS_SET_KEY, photoId]);
  await trimSetIfNeeded(USED_PEXELS_SET_KEY);
}

export async function wasTweetEngaged(tweetId: string): Promise<boolean> {
  if (!hasKvConfig()) return false;
  const data = await kvCommand(["SISMEMBER", ENGAGED_TWEETS_SET_KEY, tweetId]);
  return data.result === 1;
}

export async function markTweetAsEngaged(tweetId: string): Promise<void> {
  if (!hasKvConfig()) return;
  await kvCommand(["SADD", ENGAGED_TWEETS_SET_KEY, tweetId]);
  await trimSetIfNeeded(ENGAGED_TWEETS_SET_KEY);
}
