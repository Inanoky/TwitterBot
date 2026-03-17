import { NewsStory } from "@/lib/types";

const QUERY = encodeURIComponent(
  '(("construction" OR "built environment" OR "AEC" OR "infrastructure") AND ("AI" OR "artificial intelligence" OR "machine learning" OR "robotics"))'
);

function cleanStory(story: NewsStory): NewsStory {
  return {
    ...story,
    title: story.title?.trim() ?? "",
    description: story.description?.trim() ?? "",
    url: story.url?.trim() ?? ""
  };
}

async function fetchNewsApiStories(apiKey: string): Promise<NewsStory[]> {
  const url = `https://newsapi.org/v2/everything?q=${QUERY}&language=en&sortBy=publishedAt&pageSize=20`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": apiKey },
    next: { revalidate: 0 }
  });

  if (!res.ok) {
    throw new Error(`NewsAPI error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.articles ?? []).map((a: any) =>
    cleanStory({
      title: a.title,
      description: a.description ?? "",
      url: a.url,
      source: a.source?.name ?? "NewsAPI",
      publishedAt: a.publishedAt ?? new Date().toISOString()
    })
  );
}

async function fetchGNewsStories(apiKey: string): Promise<NewsStory[]> {
  const url = `https://gnews.io/api/v4/search?q=${QUERY}&lang=en&max=20&sortby=publishedAt&apikey=${apiKey}`;
  const res = await fetch(url, { next: { revalidate: 0 } });

  if (!res.ok) {
    throw new Error(`GNews error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.articles ?? []).map((a: any) =>
    cleanStory({
      title: a.title,
      description: a.description ?? "",
      url: a.url,
      source: a.source?.name ?? "GNews",
      publishedAt: a.publishedAt ?? new Date().toISOString()
    })
  );
}

export async function getLatestNews(): Promise<NewsStory[]> {
  const newsApiKey = process.env.NEWS_API_KEY;
  const gnewsApiKey = process.env.GNEWS_API_KEY;

  const sources: Promise<NewsStory[]>[] = [];

  if (newsApiKey) {
    sources.push(fetchNewsApiStories(newsApiKey));
  }

  if (gnewsApiKey) {
    sources.push(fetchGNewsStories(gnewsApiKey));
  }

  if (sources.length === 0) {
    throw new Error("No news source API key configured. Add NEWS_API_KEY and/or GNEWS_API_KEY.");
  }

  const settled = await Promise.allSettled(sources);

  const successful = settled
    .filter((result): result is PromiseFulfilledResult<NewsStory[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);

  if (successful.length === 0) {
    const details = settled
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason?.message ?? "Unknown fetch error")
      .join(" | ");

    throw new Error(`All news providers failed: ${details}`);
  }

  const deduped = Array.from(new Map(successful.map((s) => [s.url, s])).values())
    .filter((s) => s.url && s.title)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));

  return deduped;
}
