import OpenAI from "openai";

import { NewsStory, StorySelection, StorySocialSignal } from "@/lib/types";

const MAX_TWEET_LENGTH = 280;
const X_URL_LENGTH = 23;
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

function truncateTweet(text: string): string {
  if (text.length <= MAX_TWEET_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_TWEET_LENGTH - 1).trimEnd()}…`;
}

function truncateForUrl(text: string): string {
  const maxBodyLength = MAX_TWEET_LENGTH - (X_URL_LENGTH + 1);
  if (text.length <= maxBodyLength) {
    return text;
  }

  return `${text.slice(0, maxBodyLength - 1).trimEnd()}…`;
}

function getOpenAiClient(): OpenAI | null {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  return openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;
}

function buildFallbackBody(story: NewsStory): string {
  const hook = FALLBACK_HOOKS[Math.floor(Math.random() * FALLBACK_HOOKS.length)];
  const summarySource = story.description || story.title;
  const body = normalizeWhitespace(
    `${hook} ${summarySource} Why it matters: teams that adopt proven AI workflows earlier can move faster, cut rework, and make better site decisions.`
  );

  return `${truncateForUrl(body)} ${story.url}`;
}

function enforceTweetRequirements(text: string, storyUrl: string): string {
  const normalized = normalizeWhitespace(text);
  const hasLeadHook = /^[A-Z0-9][^.!?]{0,80}[:?!-]/.test(normalized);
  const withHook = hasLeadHook ? normalized : `Watch this: ${normalized}`;
  const withoutUrls = withHook.replace(/https?:\/\/\S+/gi, "").trim();
  return `${truncateForUrl(withoutUrls)} ${storyUrl}`;
}

function rankSignals(signals: StorySocialSignal[]): StorySocialSignal[] {
  return [...signals].sort((a, b) => b.score - a.score);
}

export async function chooseStoryForPosting(
  stories: NewsStory[],
  relatedSignalsByStory: Map<string, StorySocialSignal[]>
): Promise<StorySelection> {
  if (stories.length === 0) {
    throw new Error("No stories available for selection.");
  }

  const client = getOpenAiClient();

  if (!client) {
    const story = stories[0];
    return {
      story,
      reason: "Fallback selected the freshest story because OpenAI is not configured.",
      relatedSignals: rankSignals(relatedSignalsByStory.get(story.url) ?? []).slice(0, 3)
    };
  }

  const candidates = stories.slice(0, 8).map((story, index) => ({
    index,
    title: story.title,
    description: story.description,
    source: story.source,
    publishedAt: story.publishedAt,
    url: story.url,
    topTrendSignals: rankSignals(relatedSignalsByStory.get(story.url) ?? []).slice(0, 3)
  }));

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You pick the single most engaging AI-in-construction topic for an X account. Prefer topics with fresh news, practical implications, and visible traction in Google Trends signals. Return compact JSON with keys selectedIndex and reason."
      },
      {
        role: "user",
        content: `Choose the best topic to post next from these candidates:\n${JSON.stringify(candidates)}`
      }
    ]
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    const story = stories[0];
    return {
      story,
      reason: "Model returned empty output; fallback selected the freshest story.",
      relatedSignals: rankSignals(relatedSignalsByStory.get(story.url) ?? []).slice(0, 3)
    };
  }

  try {
    const parsed = JSON.parse(content) as { selectedIndex?: number; reason?: string };
    const selectedStory = stories[Math.max(0, Math.min(parsed.selectedIndex ?? 0, stories.length - 1))];

    return {
      story: selectedStory,
      reason: normalizeWhitespace(parsed.reason || "Chosen for likely engagement potential."),
      relatedSignals: rankSignals(relatedSignalsByStory.get(selectedStory.url) ?? []).slice(0, 3)
    };
  } catch {
    const story = stories[0];
    return {
      story,
      reason: "Failed to parse model output; fallback selected the freshest story.",
      relatedSignals: rankSignals(relatedSignalsByStory.get(story.url) ?? []).slice(0, 3)
    };
  }
}

export async function generatePost(story: NewsStory, relatedSignals: StorySocialSignal[] = []): Promise<string> {
  const client = getOpenAiClient();

  if (!client) {
    return buildFallbackBody(story);
  }

  const prompt = `Write one engaging X post about this AI + construction news.

Requirements:
- Start with a viral-style hook in the first sentence fragment
- Do not include a URL in the draft text; code will append source URL for rich link preview
- Keep final output short enough to fit one tweet after a URL is added (max ${MAX_TWEET_LENGTH} chars total)
- Keep it short and fit in one single tweet (no thread)
- Make it feel sharp, specific, and useful for contractors, developers, or project teams
- Mention why it matters in business or operational terms
- End with a short discussion prompt only when it feels natural and helps invite replies
- No hashtags unless absolutely necessary
- No more than 1 emoji, and only if it genuinely improves the post
- Return only the final tweet text

News title: ${story.title}
News description: ${story.description}
Source: ${story.source}
Article URL: ${story.url}
Relevant Google Trends signals: ${JSON.stringify(relatedSignals.slice(0, 3))}`;

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.9,
    messages: [
      {
        role: "system",
        content:
          "You write concise, high-performing X posts for B2B audiences. Every post starts with a strong hook and is short enough for one tweet even after adding a source URL. Return only the tweet text."
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

  return enforceTweetRequirements(content, story.url);
}
