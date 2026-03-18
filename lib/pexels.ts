import { NewsStory } from "@/lib/types";

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

export async function getPexelsImageUrl(story: NewsStory): Promise<string | null> {
  const apiKey = process.env.PEXELS_API;

  if (!apiKey) {
    console.warn("[xbot][pexels] missing PEXELS_API key");
    return null;
  }

  const query = buildQuery(story);
  const url = `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;
  console.log("[xbot][pexels] search", { query });

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
  const selected = (data.photos ?? []).find((photo: any) => photo?.src?.large2x || photo?.src?.large);
  return selected?.src?.large2x ?? selected?.src?.large ?? null;
}
