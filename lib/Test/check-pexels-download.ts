import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  photographer?: string;
  url?: string;
  src?: {
    original?: string;
    large2x?: string;
    large?: string;
    medium?: string;
  };
};

type PexelsResponse = {
  page?: number;
  per_page?: number;
  photos?: PexelsPhoto[];
  total_results?: number;
};

const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";

function isJpeg(buffer: Buffer) {
  return buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
}

function isPng(buffer: Buffer) {
  return buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
}

function extensionFromContentType(contentType: string | null) {
  if (!contentType) return "bin";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "bin";
}

async function searchPexels(query: string, apiKey: string): Promise<PexelsPhoto | null> {
  const url =
    `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;

  console.log("[pexels-check] search request", { query, url });

  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
  });

  console.log("[pexels-check] search response", {
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pexels search failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as PexelsResponse;
  const selected =
    data.photos?.find((photo) => photo?.src?.large2x || photo?.src?.large) ?? null;

  if (!selected) {
    return null;
  }

  console.log("[pexels-check] selected photo", {
    id: selected.id,
    width: selected.width,
    height: selected.height,
    photographer: selected.photographer,
    imageUrl: selected.src?.large2x ?? selected.src?.large ?? null,
  });

  return selected;
}

async function downloadImage(imageUrl: string) {
  console.log("[pexels-check] downloading image", { imageUrl });

  const res = await fetch(imageUrl);

  const contentType = res.headers.get("content-type");
  const contentLength = res.headers.get("content-length");

  console.log("[pexels-check] image response", {
    status: res.status,
    ok: res.ok,
    contentType,
    contentLength,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Image download failed: ${res.status} ${body}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const looksLikeJpeg = isJpeg(buffer);
  const looksLikePng = isPng(buffer);

  console.log("[pexels-check] image checks", {
    bytes: buffer.length,
    looksLikeJpeg,
    looksLikePng,
    first16BytesHex: buffer.subarray(0, 16).toString("hex"),
  });

  return {
    buffer,
    contentType,
    contentLength,
    looksLikeJpeg,
    looksLikePng,
  };
}

async function main() {
  const apiKey = process.env.PEXELS_API_KEY;
  const query = process.argv[2] || "construction technology";

  if (!apiKey) {
    throw new Error("Missing PEXELS_API in environment");
  }

  const photo = await searchPexels(query, apiKey);

  if (!photo) {
    console.log("[pexels-check] no photo returned for query");
    process.exit(0);
  }

  const imageUrl = photo.src?.large2x ?? photo.src?.large;
  if (!imageUrl) {
    throw new Error("Selected Pexels photo did not contain large2x or large URL");
  }

  const result = await downloadImage(imageUrl);

  const ext = extensionFromContentType(result.contentType);
  const outDir = path.join(process.cwd(), "tmp");
  const outPath = path.join(outDir, `pexels-check-${Date.now()}.${ext}`);

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, result.buffer);

  console.log("[pexels-check] saved file", { outPath });

  if (!result.looksLikeJpeg && !result.looksLikePng) {
    console.warn(
      "[pexels-check] warning: downloaded file is not recognized as JPEG or PNG by magic bytes"
    );
  } else {
    console.log("[pexels-check] success: image binary looks valid");
  }
}

main().catch((error) => {
  console.error("[pexels-check] failed");
  console.error(error);
  process.exit(1);
});