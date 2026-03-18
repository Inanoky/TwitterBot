import crypto from "node:crypto";
import "dotenv/config";

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

  const endpoint = "https://api.x.com/2/users/me";
  const queryParams = {
    "user.fields": "id,name,username",
  };

  const url = `${endpoint}?user.fields=${encode(queryParams["user.fields"])}`;
  const authHeader = buildOAuthHeader("GET", endpoint, queryParams, creds);

  console.log("[check-twitter-access] checking credentials...");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
  });

  const raw = await res.text();

  if (!res.ok) {
    console.error("[check-twitter-access] failed");
    console.error("Status:", res.status);
    console.error("Body:", raw);

    if (res.status === 401 || res.status === 403) {
      console.error(`
Common causes:
- wrong API key / API secret
- wrong access token / access token secret
- token was regenerated but old values are still used somewhere
- app permissions are not sufficient
- using values from a different X app/project
      `.trim());
    }

    process.exit(1);
  }

  const json = JSON.parse(raw);

  console.log("[check-twitter-access] success");
  console.log("Authenticated as:");
  console.log(`- id: ${json?.data?.id}`);
  console.log(`- name: ${json?.data?.name}`);
  console.log(`- username: @${json?.data?.username}`);
}

main().catch((err) => {
  console.error("[check-twitter-access] unexpected error");
  console.error(err);
  process.exit(1);
});