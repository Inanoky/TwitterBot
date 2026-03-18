import { wasImageUsed } from "@/lib/dedup";
import { NewsStory, PexelsImageSelection } from "@/lib/types";

const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";

function buildQuery(story: NewsStory): string {
  const sourceText = `${story.title} ${story.description}`.toLowerCase();

  if (sourceText.includes("robot")) return "construction robotics";
  if (sourceText.includes("drone")) return "construction drone";
  if (sourceText.includes("safety")) return "construction safety site";
  if (sourceText.includes("infrastructure")) return "infrastructure construction";
  if (sourceText.includes("building")) return "commercial building construction";

  return "construction technology";
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
  const photos = data.photos ?? [];

  for (const photo of photos) {
    const photoId = String(photo?.id ?? "");
    const imageUrl = photo?.src?.large2x ?? photo?.src?.large ?? null;

    if (!photoId || !imageUrl) {
      continue;
    }

    const alreadyUsed = await wasImageUsed(photoId);
    console.log("[xbot][pexels] candidate", {
      photoId,
      photographer: photo?.photographer ?? null,
      imageUrl,
      alreadyUsed
    });

    if (!alreadyUsed) {
      const selection: PexelsImageSelection = {
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
