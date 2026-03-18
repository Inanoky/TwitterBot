import OpenAI from "openai";

import { NewsStory } from "@/lib/types";

const MAX_TWEET_LENGTH = 280;
const RESERVED_FOR_LINK_REPLY = 0;
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

export async function generatePost(story: NewsStory): Promise<string> {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    return buildFallbackBody(story);
  }

  const client = new OpenAI({ apiKey: openaiApiKey });

  const prompt = `Write one engaging X post about this AI + construction news.

Requirements:
- Start with a viral-style hook in the first sentence fragment
- Do NOT include the source URL because it will be posted in the first reply
- Maximum ${MAX_TWEET_LENGTH - RESERVED_FOR_LINK_REPLY} characters
- Make it feel sharp, specific, and useful for contractors, developers, or project teams
- Mention why it matters in business or operational terms
- No hashtags unless absolutely necessary
- No more than 1 emoji, and only if it genuinely improves the post
- Return only the final tweet text

News title: ${story.title}
News description: ${story.description}
Source: ${story.source}
Article URL: ${story.url}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
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
