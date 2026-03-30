import OpenAI from "openai";

import { NewsStory, StorySelection, TwitterSearchPost } from "@/lib/types";

const MAX_TWEET_LENGTH = 280;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";
const FALLBACK_HOOKS = [
  "This changes how jobsites adopt AI:",
  "Contractors should pay attention to this:",
  "The next AI edge in construction is here:",
  "Here’s why this AI construction update matters:",
  "A smart shift is happening in construction tech:"
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function ensureSentencePunctuation(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return normalized;
  }

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function trimToCompleteThought(text: string, maxLength: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return ensureSentencePunctuation(normalized);
  }

  const clipped = normalized.slice(0, maxLength).trim();
  const sentenceEndMatches = [...clipped.matchAll(/[.!?](?=\s|$)/g)];
  const lastSentenceEnd = sentenceEndMatches.length
    ? sentenceEndMatches[sentenceEndMatches.length - 1].index ?? -1
    : -1;
  if (lastSentenceEnd >= Math.floor(maxLength * 0.45)) {
    return ensureSentencePunctuation(clipped.slice(0, lastSentenceEnd + 1).trim());
  }

  const lastWordBoundary = clipped.lastIndexOf(" ");
  if (lastWordBoundary > 0) {
    const base = clipped.slice(0, lastWordBoundary).trim();
    if (base.length < maxLength) {
      return ensureSentencePunctuation(base);
    }

    const noLastChar = base.slice(0, -1).trimEnd();
    return ensureSentencePunctuation(noLastChar);
  }

  if (clipped.length < maxLength) {
    return ensureSentencePunctuation(clipped);
  }

  return `${clipped.slice(0, -1).trimEnd()}.`;
}

function getOpenAiClient(): OpenAI | null {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  return openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;
}

function enforceHook(text: string): string {
  const normalized = normalizeWhitespace(text);
  const hasLeadHook = /^[A-Z0-9][^.!?]{0,80}[:?!-]/.test(normalized);

  if (hasLeadHook) {
    return normalized;
  }

  return `Watch this: ${normalized}`;
}

function buildTweetWithSourceUrl(body: string, sourceUrl: string): string {
  const normalizedBody = normalizeWhitespace(body).replace(new RegExp(sourceUrl, "g"), "").trim();
  const urlTokenLength = sourceUrl.length;
  const separator = normalizedBody.length > 0 ? " " : "";
  const maxBodyLength = MAX_TWEET_LENGTH - urlTokenLength - separator.length;
  const safeBody = trimToCompleteThought(enforceHook(normalizedBody), Math.max(0, maxBodyLength));
  return `${safeBody}${separator}${sourceUrl}`.trim();
}

function buildFallbackBody(story: NewsStory): string {
  const hook = FALLBACK_HOOKS[Math.floor(Math.random() * FALLBACK_HOOKS.length)];
  const summarySource = story.description || story.title;
  const body = normalizeWhitespace(
    `${hook} ${summarySource} Why it matters: teams that adopt proven AI workflows earlier can move faster and reduce rework.`
  );

  return buildTweetWithSourceUrl(body, story.url);
}

export async function chooseStoryForPosting(
  stories: NewsStory[],
  trendSignalsByStory: Map<string, { score: number; matchedTrendTitles: string[] }>
): Promise<StorySelection> {
  if (stories.length === 0) {
    throw new Error("No stories available for selection.");
  }

  const scoredStories = stories
    .map((story) => {
      const trendSignal = trendSignalsByStory.get(story.url) ?? { score: 0, matchedTrendTitles: [] };
      return {
        story,
        trendScore: trendSignal.score,
        matchedTrendTitles: trendSignal.matchedTrendTitles
      };
    })
    .sort((a, b) => b.trendScore - a.trendScore);

  const client = getOpenAiClient();
  if (!client) {
    const top = scoredStories[0];
    return {
      story: top.story,
      trendScore: top.trendScore,
      matchedTrendTitles: top.matchedTrendTitles,
      reason: "Fallback selected the top story using Google Trends overlap."
    };
  }

  const candidates = scoredStories.slice(0, 8).map((candidate, index) => ({
    index,
    title: candidate.story.title,
    description: candidate.story.description,
    source: candidate.story.source,
    publishedAt: candidate.story.publishedAt,
    url: candidate.story.url,
    trendScore: candidate.trendScore,
    matchedTrendTitles: candidate.matchedTrendTitles
  }));

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You pick the single most engaging AI-in-construction topic for an X account. Prefer stories with high Google Trends overlap, freshness, and practical business impact. Return compact JSON with keys selectedIndex and reason."
      },
      {
        role: "user",
        content: `Choose the best topic to post next from these candidates:\n${JSON.stringify(candidates)}`
      }
    ]
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    const top = scoredStories[0];
    return {
      story: top.story,
      trendScore: top.trendScore,
      matchedTrendTitles: top.matchedTrendTitles,
      reason: "Model returned empty output; fallback selected top Google Trends overlap story."
    };
  }

  try {
    const parsed = JSON.parse(content) as { selectedIndex?: number; reason?: string };
    const selectedIndex = Math.max(0, Math.min(parsed.selectedIndex ?? 0, candidates.length - 1));
    const selectedCandidate = scoredStories[selectedIndex];

    return {
      story: selectedCandidate.story,
      trendScore: selectedCandidate.trendScore,
      matchedTrendTitles: selectedCandidate.matchedTrendTitles,
      reason: normalizeWhitespace(parsed.reason || "Chosen for likely engagement potential.")
    };
  } catch {
    const top = scoredStories[0];
    return {
      story: top.story,
      trendScore: top.trendScore,
      matchedTrendTitles: top.matchedTrendTitles,
      reason: "Failed to parse model output; fallback selected top Google Trends overlap story."
    };
  }
}

export async function generatePost(story: NewsStory): Promise<string> {
  const client = getOpenAiClient();

  if (!client) {
    return buildFallbackBody(story);
  }

  const prompt = `Write one engaging X post about this AI + construction news.

Requirements:
- Start with a strong hook in the first sentence fragment
- Keep the post concise and useful for contractors, developers, or project teams
- Mention why it matters in business or operational terms
- Include this source URL exactly once at the end of the post: ${story.url}
- Entire post (text + URL + space) must stay within ${MAX_TWEET_LENGTH} characters
- The post body must end as a complete sentence with final punctuation before the URL
- No hashtags unless absolutely necessary
- No more than 1 emoji, and only if it improves clarity
- Return only the final tweet text

News title: ${story.title}
News description: ${story.description}
Source: ${story.source}
Article URL: ${story.url}`;

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.9,
    messages: [
      {
        role: "system",
        content:
          "You write concise, high-performing X posts for B2B audiences. Every post starts with a strong hook and fits the character limit. Return only the tweet text."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    return buildFallbackBody(story);
  }

  return buildTweetWithSourceUrl(content, story.url);
}

export async function generateEngagementReply(post: TwitterSearchPost): Promise<string> {
  const fallback = truncateText(
    `Strong signal here. The teams that tie AI to real field workflows usually see value faster. Curious what implementation step mattered most for you?`,
    MAX_TWEET_LENGTH
  );

  const client = getOpenAiClient();
  if (!client) {
    return fallback;
  }

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content:
          "Write one concise, thoughtful reply for X. Sound human and professional. No hashtags. No links. Keep it under 240 characters."
      },
      {
        role: "user",
        content: `Create a reply to this post:\n${post.text}\nContext: AI + construction audience growth.`
      }
    ]
  });

  const content = normalizeWhitespace(response.choices[0]?.message?.content?.trim() || "");
  return content ? truncateText(content, 240) : fallback;
}
