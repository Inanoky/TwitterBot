import OpenAI from "openai";

import { NewsStory } from "@/lib/types";

const FALLBACK_HOOKS = [
  "AI is quietly reshaping jobsite reality:",
  "New signal from the AI + construction frontier:",
  "Big shift for builders adopting AI:",
  "Construction tech is accelerating fast:",
  "Fresh trend worth watching in AI-driven construction:"
];

function fallbackPost(story: NewsStory): string {
  const hook = FALLBACK_HOOKS[Math.floor(Math.random() * FALLBACK_HOOKS.length)];
  const base = `${hook} ${story.title}`;
  const withSource = `${base} (${story.source})\n\n${story.url}`;
  return withSource.slice(0, 279);
}

export async function generatePost(story: NewsStory): Promise<string> {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    return fallbackPost(story);
  }

  const client = new OpenAI({ apiKey: openaiApiKey });

  const prompt = `Create one engaging X post about this AI+construction news.

Requirements:
- Max 280 chars total, include URL at the end
- Tone: insightful, energetic, practical
- Mention why this matters for contractors, developers, or project teams
- No clickbait, no emojis overuse (0-1 max), no hashtags unless highly relevant
- Must be unique wording

News title: ${story.title}
News description: ${story.description}
Source: ${story.source}
URL: ${story.url}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.9,
    messages: [
      {
        role: "system",
        content:
          "You write concise, high-performing X posts for B2B tech audiences. Return only the post text."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    return fallbackPost(story);
  }

  const trimmed = content.slice(0, 280);
  return trimmed.includes(story.url) ? trimmed : `${trimmed}\n${story.url}`.slice(0, 280);
}
