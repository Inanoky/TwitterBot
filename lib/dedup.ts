const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const POSTED_SET_KEY = "xbot:posted_story_urls";
const USED_IMAGE_SET_KEY = "xbot:used_image_ids";
const MAX_TRACKED_URLS = 500;
const MAX_TRACKED_IMAGES = 500;
const memoryPostedImages = new Set<string>();

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

async function trimSet(setKey: string, maxTracked: number) {
  const size = await kvCommand(["SCARD", setKey]);

  if ((size.result ?? 0) > maxTracked) {
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
  await trimSet(POSTED_SET_KEY, MAX_TRACKED_URLS);
}

export async function wasImageUsed(imageId: string): Promise<boolean> {
  if (hasKvConfig()) {
    const data = await kvCommand(["SISMEMBER", USED_IMAGE_SET_KEY, imageId]);
    return data.result === 1;
  }

  const alreadyUsed = memoryPostedImages.has(imageId);
  console.log("[xbot][kv] image dedup fallback", { imageId, alreadyUsed });
  return alreadyUsed;
}

export async function markImageAsUsed(imageId: string): Promise<void> {
  if (hasKvConfig()) {
    await kvCommand(["SADD", USED_IMAGE_SET_KEY, imageId]);
    await trimSet(USED_IMAGE_SET_KEY, MAX_TRACKED_IMAGES);
    return;
  }

  memoryPostedImages.add(imageId);
  if (memoryPostedImages.size > MAX_TRACKED_IMAGES) {
    const firstValue = memoryPostedImages.values().next().value;
    if (firstValue) {
      memoryPostedImages.delete(firstValue);
    }
  }

  console.log("[xbot][kv] image dedup fallback mark", { imageId, trackedCount: memoryPostedImages.size });
}

export function isKvEnabled(): boolean {
  return hasKvConfig();
}
