import OpenAI from "openai";

import { NewsStory, StorySelection, TwitterSearchPost } from "@/lib/types";

const MAX_TWEET_LENGTH = 280;
const RESERVED_FOR_LINK_REPLY = 0;
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

  return truncateTweet(body);
}

function enforceHook(text: string): string {
  const normalized = normalizeWhitespace(text);
  const hasLeadHook = /^[A-Z0-9][^.!?]{0,80}[:?!-]/.test(normalized);

  if (hasLeadHook) {
    return truncateTweet(normalized);
  }

  return truncateTweet(`Watch this: ${normalized}`);
}

function rankPosts(posts: TwitterSearchPost[]): TwitterSearchPost[] {
  return [...posts].sort((a, b) => {
    const scoreA = a.likeCount + a.retweetCount * 2 + a.replyCount * 2 + a.quoteCount * 2;
    const scoreB = b.likeCount + b.retweetCount * 2 + b.replyCount * 2 + b.quoteCount * 2;
    return scoreB - scoreA;
  });
}

export async function chooseStoryForPosting(
  stories: NewsStory[],
  relatedPostsByStory: Map<string, TwitterSearchPost[]>
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
      relatedPosts: rankPosts(relatedPostsByStory.get(story.url) ?? []).slice(0, 3)
    };
  }

  const candidates = stories.slice(0, 8).map((story, index) => ({
    index,
    title: story.title,
    description: story.description,
    source: story.source,
    publishedAt: story.publishedAt,
    url: story.url,
    topPosts: rankPosts(relatedPostsByStory.get(story.url) ?? []).slice(0, 3).map((post) => ({
      text: post.text,
      likeCount: post.likeCount,
      retweetCount: post.retweetCount,
      replyCount: post.replyCount,
      quoteCount: post.quoteCount,
      url: post.url
    }))
  }));

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You pick the single most engaging AI-in-construction topic for an X account. Prefer topics with fresh news, practical implications, and visible traction in social conversation. Return compact JSON with keys selectedIndex and reason."
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
      relatedPosts: rankPosts(relatedPostsByStory.get(story.url) ?? []).slice(0, 3)
    };
  }

  try {
    const parsed = JSON.parse(content) as { selectedIndex?: number; reason?: string };
    const selectedStory = stories[Math.max(0, Math.min(parsed.selectedIndex ?? 0, stories.length - 1))];

    return {
      story: selectedStory,
      reason: normalizeWhitespace(parsed.reason || "Chosen for likely engagement potential."),
      relatedPosts: rankPosts(relatedPostsByStory.get(selectedStory.url) ?? []).slice(0, 3)
    };
  } catch {
    const story = stories[0];
    return {
      story,
      reason: "Failed to parse model output; fallback selected the freshest story.",
      relatedPosts: rankPosts(relatedPostsByStory.get(story.url) ?? []).slice(0, 3)
    };
  }
}

export async function generatePost(story: NewsStory, relatedPosts: TwitterSearchPost[] = []): Promise<string> {
  const client = getOpenAiClient();

  if (!client) {
    return buildFallbackBody(story);
  }

  const prompt = `Write one engaging X post about this AI + construction news.

Requirements:
- Start with a viral-style hook in the first sentence fragment
- Do NOT include the source URL because it will be posted in the first reply
- Maximum ${MAX_TWEET_LENGTH - RESERVED_FOR_LINK_REPLY} characters
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
Relevant X conversation: ${JSON.stringify(relatedPosts.slice(0, 3))}`;

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

  return enforceHook(content);
}

