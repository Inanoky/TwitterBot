const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const POSTED_SET_KEY = "xbot:posted_story_urls";
const USED_PEXELS_SET_KEY = "xbot:used_pexels_photo_ids";
const LIKED_TWEETS_SET_KEY = "xbot:liked_tweet_ids";
const FOLLOWED_USERS_SET_KEY = "xbot:followed_user_ids";
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

async function isMember(setKey: string, value: string): Promise<boolean> {
  if (!hasKvConfig()) return false;
  const data = await kvCommand(["SISMEMBER", setKey, value]);
  return data.result === 1;
}

async function addMember(setKey: string, value: string): Promise<void> {
  if (!hasKvConfig()) return;
  await kvCommand(["SADD", setKey, value]);
  await trimSetIfNeeded(setKey);
}

export async function wasStoryPosted(url: string): Promise<boolean> {
  if (!hasKvConfig()) {
    console.log("[xbot][kv] dedup disabled (missing KV config)");
    return false;
  }

  return isMember(POSTED_SET_KEY, url);
}

export async function markStoryAsPosted(url: string): Promise<void> {
  if (!hasKvConfig()) {
    console.log("[xbot][kv] skip mark (missing KV config)");
    return;
  }

  await addMember(POSTED_SET_KEY, url);
}

export function isKvEnabled(): boolean {
  return hasKvConfig();
}

export async function wasPexelsPhotoUsed(photoId: string): Promise<boolean> {
  return isMember(USED_PEXELS_SET_KEY, photoId);
}

export async function markPexelsPhotoUsed(photoId: string): Promise<void> {
  await addMember(USED_PEXELS_SET_KEY, photoId);
}

export async function wasTweetLiked(tweetId: string): Promise<boolean> {
  return isMember(LIKED_TWEETS_SET_KEY, tweetId);
}

export async function markTweetLiked(tweetId: string): Promise<void> {
  await addMember(LIKED_TWEETS_SET_KEY, tweetId);
}

export async function wasUserFollowed(userId: string): Promise<boolean> {
  return isMember(FOLLOWED_USERS_SET_KEY, userId);
}

export async function markUserFollowed(userId: string): Promise<void> {
  await addMember(FOLLOWED_USERS_SET_KEY, userId);
}
