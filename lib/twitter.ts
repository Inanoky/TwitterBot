import crypto from "node:crypto";

type OAuthCredentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

type CreateTweetOptions = {
  replyToTweetId?: string;
  mediaIds?: string[];
};

type TwitterPostResult = {
  id: string;
  text: string;
};

function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function getCredentials(): OAuthCredentials {
  const creds: OAuthCredentials = {
    consumerKey: process.env.TWITTER_API_KEY ?? "",
    consumerSecret: process.env.TWITTER_API_SECRET ?? "",
    accessToken: process.env.TWITTER_ACCESS_TOKEN ?? "",
    accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET ?? "",
  };

  const missing = Object.entries(creds)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing Twitter credentials: ${missing.join(", ")}`);
  }

  return creds;
}

function buildOAuthHeader(
  method: string,
  url: string,
  queryParams: Record<string, string>,
  creds: OAuthCredentials
) {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...queryParams };

  const parameterString = Object.keys(allParams)
    .sort()
    .map((key) => `${encode(key)}=${encode(allParams[key])}`)
    .join("&");

  const baseString = [method.toUpperCase(), encode(url), encode(parameterString)].join("&");
  const signingKey = `${encode(creds.consumerSecret)}&${encode(creds.accessTokenSecret)}`;

  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  const signedOAuth: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };

  return (
    "OAuth " +
    Object.keys(signedOAuth)
      .sort()
      .map((key) => `${encode(key)}="${encode(signedOAuth[key])}"`)
      .join(", ")
  );
}

async function fetchBinary(url: string): Promise<Buffer> {
  const res = await fetch(url, { next: { revalidate: 0 } });

  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status} ${await res.text()}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function uploadTwitterMediaFromUrl(imageUrl: string): Promise<string> {
  const creds = getCredentials();
  const endpoint = "https://upload.twitter.com/1.1/media/upload.json";
  const imageBuffer = await fetchBinary(imageUrl);
  const mediaData = imageBuffer.toString("base64");
  const queryParams = { media_data: mediaData };
  const authHeader = buildOAuthHeader("POST", endpoint, queryParams, creds);

  const body = new URLSearchParams(queryParams);

  console.log("[xbot][twitter] uploading media", { bytes: imageBuffer.length });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const raw = await res.text();
    console.error("[xbot][twitter] media upload failed", { status: res.status, body: raw });
    throw new Error(`Twitter media upload error: ${res.status} ${raw}`);
  }

  const json = await res.json();
  const mediaId = json.media_id_string;

  if (!mediaId) {
    throw new Error("Twitter media upload did not return media_id_string");
  }

  return mediaId;
}

export async function postToTwitter(text: string, options: CreateTweetOptions = {}): Promise<TwitterPostResult> {
  const creds = getCredentials();
  const endpoint = "https://api.twitter.com/2/tweets";
  const payload: Record<string, unknown> = { text };

  if (options.replyToTweetId) {
    payload.reply = { in_reply_to_tweet_id: options.replyToTweetId };
  }

  if (options.mediaIds && options.mediaIds.length > 0) {
    payload.media = { media_ids: options.mediaIds };
  }

  const authHeader = buildOAuthHeader("POST", endpoint, {}, creds);

  console.log("[xbot][twitter] posting", {
    endpoint,
    textLength: text.length,
    replyToTweetId: options.replyToTweetId,
    mediaCount: options.mediaIds?.length ?? 0,
    preview: text.slice(0, 120),
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const raw = await res.text();
    console.error("[xbot][twitter] post failed", { status: res.status, body: raw });
    throw new Error(`Twitter API error: ${res.status} ${raw}`);
  }

  const json = await res.json();
  console.log("[xbot][twitter] post success", { tweetId: json?.data?.id });
  return json.data;
}
