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

type TwitterRequestOptions = {
  body?: BodyInit;
  contentType?: string;
  formParams?: Record<string, string>;
  method?: "GET" | "POST";
};

type FinalizeResponse = {
  media_id_string?: string;
  processing_info?: {
    state?: "pending" | "in_progress" | "succeeded" | "failed";
    check_after_secs?: number;
    error?: {
      code?: number;
      name?: string;
      message?: string;
    };
  };
};

const TWITTER_TWEET_ENDPOINT = "https://api.twitter.com/2/tweets";
const TWITTER_MEDIA_ENDPOINT = "https://upload.twitter.com/1.1/media/upload.json";
const MAX_STATUS_POLLS = 6;

function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function twitterRequest<T>(
  endpoint: string,
  options: TwitterRequestOptions = {}
): Promise<T> {
  const creds = getCredentials();
  const method = options.method ?? "POST";
  const formParams = options.formParams ?? {};
  const authHeader = buildOAuthHeader(method, endpoint, formParams, creds);

  const url =
    method === "GET" && Object.keys(formParams).length > 0
      ? `${endpoint}?${new URLSearchParams(formParams).toString()}`
      : endpoint;

  console.log("[xbot][twitter] request", {
    endpoint,
    method,
    hasBody: method === "GET" ? false : Boolean(options.body),
    contentType: options.contentType ?? (options.body instanceof FormData ? "multipart/form-data" : null),
    formParams: Object.keys(formParams).length > 0 ? formParams : null
  });

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      ...(options.contentType ? { "Content-Type": options.contentType } : {}),
    },
    body: method === "GET" ? undefined : options.body,
  });

  if (!res.ok) {
    const raw = await res.text();
    console.error("[xbot][twitter] request failed", {
      endpoint,
      method,
      status: res.status,
      body: raw,
    });
    throw new Error(`Twitter API error: ${res.status} ${raw}`);
  }

  const json = (await res.json()) as T;
  console.log("[xbot][twitter] request success", { endpoint, method });
  return json;
}

async function initializeMediaUpload(totalBytes: number): Promise<string> {
  const formParams = {
    command: "INIT",
    media_type: "image/jpeg",
    media_category: "tweet_image",
    total_bytes: totalBytes.toString(),
  };

  console.log("[xbot][twitter] media init", { totalBytes });

  const json = await twitterRequest<{ media_id_string?: string }>(TWITTER_MEDIA_ENDPOINT, {
    method: "POST",
    formParams,
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams(formParams).toString(),
  });

  if (!json.media_id_string) {
    throw new Error("Twitter INIT upload did not return media_id_string");
  }

  console.log("[xbot][twitter] media init success", { mediaId: json.media_id_string });
  return json.media_id_string;
}

async function appendMediaChunk(mediaId: string, imageBuffer: Buffer): Promise<void> {
  console.log("[xbot][twitter] media append", { mediaId, bytes: imageBuffer.length });

  const form = new FormData();
  form.append("command", "APPEND");
  form.append("media_id", mediaId);
  form.append("segment_index", "0");
  form.append("media", new Blob([imageBuffer], { type: "image/jpeg" }), "image.jpg");

  await twitterRequest(TWITTER_MEDIA_ENDPOINT, {
    method: "POST",
    body: form,
  });

  console.log("[xbot][twitter] media append success", { mediaId });
}

async function pollMediaStatus(mediaId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_STATUS_POLLS; attempt += 1) {
    const formParams = {
      command: "STATUS",
      media_id: mediaId,
    };

    const json = await twitterRequest<FinalizeResponse>(TWITTER_MEDIA_ENDPOINT, {
      method: "GET",
      formParams,
    });

    const state = json.processing_info?.state;
    console.log("[xbot][twitter] media status", {
      mediaId,
      attempt: attempt + 1,
      state: state ?? null,
      checkAfterSecs: json.processing_info?.check_after_secs ?? null,
      error: json.processing_info?.error ?? null
    });

    if (!state || state === "succeeded") {
      return;
    }

    if (state === "failed") {
      const errorMessage = json.processing_info?.error?.message ?? "Unknown media processing error";
      throw new Error(`Twitter media processing failed: ${errorMessage}`);
    }

    const delayMs = (json.processing_info?.check_after_secs ?? 1) * 1000;
    console.log("[xbot][twitter] waiting for media processing", { mediaId, state, delayMs });
    await sleep(delayMs);
  }

  throw new Error("Twitter media processing timed out");
}

async function finalizeMediaUpload(mediaId: string): Promise<void> {
  const formParams = {
    command: "FINALIZE",
    media_id: mediaId,
  };

  console.log("[xbot][twitter] media finalize", { mediaId });

  const json = await twitterRequest<FinalizeResponse>(TWITTER_MEDIA_ENDPOINT, {
    method: "POST",
    formParams,
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams(formParams).toString(),
  });

  console.log("[xbot][twitter] media finalize response", {
    mediaId,
    state: json.processing_info?.state ?? null,
    checkAfterSecs: json.processing_info?.check_after_secs ?? null,
    error: json.processing_info?.error ?? null
  });

  if (json.processing_info?.state && json.processing_info.state !== "succeeded") {
    await pollMediaStatus(mediaId);
  }
}

export async function uploadTwitterMediaFromUrl(imageUrl: string): Promise<string> {
  const imageBuffer = await fetchBinary(imageUrl);
  console.log("[xbot][twitter] uploading media", { bytes: imageBuffer.length, imageUrl });

  const mediaId = await initializeMediaUpload(imageBuffer.length);
  await appendMediaChunk(mediaId, imageBuffer);
  await finalizeMediaUpload(mediaId);

  console.log("[xbot][twitter] media upload success", { mediaId, imageUrl });
  return mediaId;
}

export async function postToTwitter(text: string, options: CreateTweetOptions = {}): Promise<TwitterPostResult> {
  const payload: Record<string, unknown> = { text };

  if (options.replyToTweetId) {
    payload.reply = { in_reply_to_tweet_id: options.replyToTweetId };
  }

  if (options.mediaIds && options.mediaIds.length > 0) {
    payload.media = { media_ids: options.mediaIds };
  }

  console.log("[xbot][twitter] posting", {
    endpoint: TWITTER_TWEET_ENDPOINT,
    textLength: text.length,
    replyToTweetId: options.replyToTweetId,
    mediaCount: options.mediaIds?.length ?? 0,
    preview: text.slice(0, 120),
  });

  console.log("[xbot][twitter] tweet payload", payload);

  const json = await twitterRequest<{ data: TwitterPostResult }>(TWITTER_TWEET_ENDPOINT, {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify(payload),
  });

  console.log("[xbot][twitter] post success", { tweetId: json?.data?.id });
  return json.data;
}
