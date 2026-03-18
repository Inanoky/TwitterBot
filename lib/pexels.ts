import { wasImageUsed } from "@/lib/dedup";
import { NewsStory, PexelsImageSelection } from "@/lib/types";

const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";

type PexelsPhoto = {
  id?: number | string;
  photographer?: string;
  src?: {
    large2x?: string;
    large?: string;
    original?: string;
  };
};

function buildQuery(story: NewsStory): string {
  const sourceText = `${story.title} ${story.description}`.toLowerCase();

  if (sourceText.includes("robot")) return "construction robotics";
  if (sourceText.includes("drone")) return "construction drone";
  if (sourceText.includes("safety")) return "construction safety site";
  if (sourceText.includes("infrastructure")) return "infrastructure construction";
  if (sourceText.includes("building")) return "commercial building construction";

  return "construction technology";
}

function normalizePexelsUrl(url: string): string {
  try {
    const normalized = new URL(url);
    normalized.search = "";
    return normalized.toString();
  } catch {
    return url;
  }
}

function getPexelsDedupKey(photo: PexelsPhoto): string | null {
  const photoId = String(photo?.id ?? "");

  if (photoId) {
    return `pexels:photo:${photoId}`;
  }

  const sourceUrl = photo?.src?.original ?? photo?.src?.large2x ?? photo?.src?.large ?? null;
  if (!sourceUrl) {
    return null;
  }

  return `pexels:url:${normalizePexelsUrl(sourceUrl)}`;
}

export async function getPexelsImage(story: NewsStory): Promise<PexelsImageSelection | null> {
  const apiKey = process.env.PEXELS_API;

  if (!apiKey) {
    console.warn("[xbot][pexels] missing PEXELS_API key");
    return null;
  }

  const query = buildQuery(story);
  const url = `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;
  console.log("[xbot][pexels] search", {
    query,
    url,
    title: story.title,
    source: story.source
  });

  const res = await fetch(url, {
    headers: {
      Authorization: apiKey
    },
    next: { revalidate: 0 }
  });

  if (!res.ok) {
    console.error("[xbot][pexels] search failed", { status: res.status, body: await res.text() });
    return null;
  }

  const data = await res.json();
  const photos: PexelsPhoto[] = data.photos ?? [];
  const seenDedupKeys = new Set<string>();

  for (const photo of photos) {
    const photoId = String(photo?.id ?? "");
    const imageUrl = photo?.src?.large2x ?? photo?.src?.large ?? null;
    const dedupKey = getPexelsDedupKey(photo);

    if (!photoId || !imageUrl || !dedupKey) {
      continue;
    }

    const duplicateInResponse = seenDedupKeys.has(dedupKey);
    if (duplicateInResponse) {
      console.log("[xbot][pexels] skipped duplicate candidate in response", { photoId, dedupKey, imageUrl });
      continue;
    }

    seenDedupKeys.add(dedupKey);

    const alreadyUsed = await wasImageUsed(dedupKey);
    console.log("[xbot][pexels] candidate", {
      photoId,
      dedupKey,
      photographer: photo?.photographer ?? null,
      imageUrl,
      alreadyUsed
    });

    if (!alreadyUsed) {
      const selection: PexelsImageSelection = {
        dedupKey,
        photoId,
        imageUrl,
        photographer: photo?.photographer ?? null
      };

      console.log("[xbot][pexels] selected unused image", {
        totalResults: data.total_results ?? null,
        returnedPhotos: photos.length,
        ...selection
      });

      return selection;
    }
  }

  console.warn("[xbot][pexels] no unused image found", {
    totalResults: data.total_results ?? null,
    returnedPhotos: photos.length
  });
  return null;
}
