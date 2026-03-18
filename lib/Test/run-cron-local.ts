import "dotenv/config";

const baseUrl = process.env.LOCAL_BASE_URL || "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET || "";
const endpoint = `${baseUrl}/api/cron/post`;

async function main() {
  if (!cronSecret) {
    console.error("Missing CRON_SECRET in environment.");
    process.exit(1);
  }

  console.log("[run-cron-local] starting", {
    endpoint,
    hasCronSecret: !!cronSecret,
  });

  const startedAt = Date.now();

  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  });

  const text = await res.text();
  const elapsedMs = Date.now() - startedAt;

  console.log("[run-cron-local] response", {
    status: res.status,
    ok: res.ok,
    elapsedMs,
  });

  try {
    const json = JSON.parse(text);
    console.log("[run-cron-local] body (json)");
    console.dir(json, { depth: null });
  } catch {
    console.log("[run-cron-local] body (raw)");
    console.log(text);
  }

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[run-cron-local] unexpected error");
  console.error(err);
  process.exit(1);
});