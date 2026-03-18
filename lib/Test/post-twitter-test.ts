import "dotenv/config";
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
): string {
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

async function main() {
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
    console.error("Missing Twitter/X credentials:", missing.join(", "));
    process.exit(1);
  }

  const endpoint = "https://api.x.com/2/tweets";
  const authHeader = buildOAuthHeader("POST", endpoint, {}, creds);

  const body = {
    text: `Test post from script ${new Date().toISOString()}`,
  };

  console.log("[post-twitter-test] creating post...");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();

  console.log("Status:", res.status);
  console.log("Response:", raw);

  if (!res.ok) {
    process.exit(1);
  }

  try {
    const json = JSON.parse(raw);
    console.log("[post-twitter-test] success");
    console.log("Tweet id:", json?.data?.id);
    console.log("Tweet text:", json?.data?.text);
  } catch {
    console.log("[post-twitter-test] success, but response was not JSON");
  }
}

main().catch((err) => {
  console.error("[post-twitter-test] unexpected error");
  console.error(err);
  process.exit(1);
});