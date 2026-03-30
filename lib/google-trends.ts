import { NewsStory } from "@/lib/types";

type TrendItem = {
  title: string;
  approxTraffic?: string;
};

const GOOGLE_TRENDS_RSS = "https://trends.google.com/trending/rss?geo=US";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(value: string): string {
  return decodeXmlEntities(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function parseTrendItems(xml: string): TrendItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

  return items
    .map<TrendItem | null>((item) => {
      const block = item[1];
      const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/);
      const trafficMatch = block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/);
      const title = cleanText((titleMatch?.[1] || titleMatch?.[2] || "").trim());

      if (!title) {
        return null;
      }

      return {
        title,
        approxTraffic: trafficMatch?.[1] ? cleanText(trafficMatch[1]) : undefined
      };
    })
    .filter((item): item is TrendItem => item !== null);
}

function computeStoryTrendScore(story: NewsStory, trends: TrendItem[]): { score: number; matchedTrendTitles: string[] } {
  const storyTokens = new Set(tokenize(`${story.title} ${story.description} ${story.source}`));
  let score = 0;
  const matchedTrendTitles: string[] = [];

  for (const trend of trends) {
    const trendTokens = tokenize(trend.title);
    const overlap = trendTokens.filter((token) => storyTokens.has(token)).length;

    if (overlap > 0) {
      score += overlap;
      matchedTrendTitles.push(trend.title);
    }
  }

  return { score, matchedTrendTitles: matchedTrendTitles.slice(0, 3) };
}

export async function getGoogleTrendSignalsForStories(
  stories: NewsStory[]
): Promise<Map<string, { score: number; matchedTrendTitles: string[] }>> {
  const signals = new Map<string, { score: number; matchedTrendTitles: string[] }>();

  try {
    const res = await fetch(GOOGLE_TRENDS_RSS, { next: { revalidate: 1800 } });

    if (!res.ok) {
      throw new Error(`Google Trends RSS failed: ${res.status} ${await res.text()}`);
    }

    const xml = await res.text();
    const trends = parseTrendItems(xml);

    for (const story of stories) {
      signals.set(story.url, computeStoryTrendScore(story, trends));
    }
  } catch (error) {
    console.error("[xbot][trends] failed to load Google Trends", {
      error: error instanceof Error ? error.message : String(error)
    });

    for (const story of stories) {
      signals.set(story.url, { score: 0, matchedTrendTitles: [] });
    }
  }

  return signals;
}
