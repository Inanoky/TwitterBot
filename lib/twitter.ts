import crypto from "node:crypto";

type OAuthCredentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
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

  const baseString = [
    method.toUpperCase(),
    encode(url),
    encode(parameterString),
  ].join("&");

  const signingKey = `${encode(creds.consumerSecret)}&${encode(
    creds.accessTokenSecret
  )}`;

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const signedOAuth = {
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

export async function postToTwitter(
  text: string
): Promise<{ id: string; text: string }> {
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

  const endpoint = "https://api.twitter.com/2/tweets";
  const payload = { text };

  // Important: do NOT include JSON body fields in OAuth signature params
  const authHeader = buildOAuthHeader("POST", endpoint, {}, creds);

  console.log("[xbot][twitter] posting", {
    endpoint,
    textLength: text.length,
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
    console.error("[xbot][twitter] post failed", {
      status: res.status,
      body: raw,
    });
    throw new Error(`Twitter API error: ${res.status} ${raw}`);
  }

  const json = await res.json();
  console.log("[xbot][twitter] post success", { tweetId: json?.data?.id });
  return json.data;
}