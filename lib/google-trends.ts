import { NewsStory, StorySocialSignal } from "@/lib/types";

const GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=US";

function htmlDecode(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractKeywordSet(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length >= 4)
  );
}

function parseTagValue(block: string, tagName: string): string {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? htmlDecode(stripCdata(match[1])) : "";
}

function parseTrendItems(xml: string): StorySocialSignal[] {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);

  return itemBlocks
    .map((item, index) => {
      const title = parseTagValue(item, "title");
      const url = parseTagValue(item, "link");
      const source = parseTagValue(item, "ht:news_item_source") || undefined;

      if (!title || !url) {
        return null;
      }

      return {
        title,
        url,
        source,
        score: Math.max(1, 100 - index * 4)
      } as StorySocialSignal;
    })
    .filter((signal): signal is StorySocialSignal => Boolean(signal));
}

function scoreTrendMatch(story: NewsStory, trend: StorySocialSignal): number {
  const storyKeywords = extractKeywordSet(`${story.title} ${story.description} ${story.source}`);
  const trendKeywords = extractKeywordSet(`${trend.title} ${trend.source ?? ""}`);

  if (storyKeywords.size === 0 || trendKeywords.size === 0) {
    return 0;
  }

  let overlapCount = 0;
  for (const token of trendKeywords) {
    if (storyKeywords.has(token)) {
      overlapCount += 1;
    }
  }

  if (overlapCount === 0) {
    return 0;
  }

  return overlapCount * 20 + trend.score;
}

export async function getGoogleTrendsSignalsForStories(stories: NewsStory[]): Promise<Map<string, StorySocialSignal[]>> {
  const signalsByStory = new Map<string, StorySocialSignal[]>();

  for (const story of stories) {
    signalsByStory.set(story.url, []);
  }

  if (stories.length === 0) {
    return signalsByStory;
  }

  const response = await fetch(GOOGLE_TRENDS_RSS_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; xbot/1.0; +https://example.com/bot)"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Google Trends RSS lookup failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const trendItems = parseTrendItems(xml);

  for (const story of stories) {
    const matches = trendItems
      .map((trend) => ({ trend, matchScore: scoreTrendMatch(story, trend) }))
      .filter((entry) => entry.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5)
      .map((entry) => ({
        ...entry.trend,
        score: entry.matchScore
      }));

    signalsByStory.set(story.url, matches);
  }

  return signalsByStory;
}
