import { wasPexelsPhotoUsed } from "@/lib/dedup";
import { NewsStory } from "@/lib/types";

const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";

type PexelsPhoto = {
  id: number;
  src?: {
    large2x?: string;
    large?: string;
  };
  photographer?: string;
};

export type PexelsSelection = {
  id: string;
  imageUrl: string;
  photographer?: string;
  query: string;
} | null;

function buildQuery(story: NewsStory): string {
  const sourceText = `${story.title} ${story.description}`.toLowerCase();

  if (sourceText.includes("robot")) return "construction robotics";
  if (sourceText.includes("drone")) return "construction drone";
  if (sourceText.includes("safety")) return "construction safety site";
  if (sourceText.includes("infrastructure")) return "infrastructure construction";
  if (sourceText.includes("building")) return "commercial building construction";

  return "construction technology";
}

async function fetchPexelsPage(apiKey: string, query: string, page = 1): Promise<PexelsPhoto[]> {
  const url =
    `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=10&page=${page}&orientation=landscape`;

  const res = await fetch(url, {
    headers: { Authorization: apiKey },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    console.error("[xbot][pexels] search failed", {
      status: res.status,
      body: await res.text(),
      query,
      page,
    });
    return [];
  }

  const data = await res.json();
  return data.photos ?? [];
}

export async function getPexelsImage(story: NewsStory): Promise<PexelsSelection> {
  const apiKey = process.env.PEXELS_API;
  if (!apiKey) {
    console.warn("[xbot][pexels] missing PEXELS_API key");
    return null;
  }

  const query = buildQuery(story);
  console.log("[xbot][pexels] search", { query });

  for (const page of [1, 2]) {
    const photos = await fetchPexelsPage(apiKey, query, page);

    for (const photo of photos) {
      const imageUrl = photo?.src?.large2x ?? photo?.src?.large;
      const photoId = String(photo?.id ?? "");

      if (!photoId || !imageUrl) continue;

      const alreadyUsed = await wasPexelsPhotoUsed(photoId);
      if (alreadyUsed) continue;

      return {
        id: photoId,
        imageUrl,
        photographer: photo.photographer,
        query,
      };
    }
  }

  console.warn("[xbot][pexels] no unused photos found", { query });
  return null;
}