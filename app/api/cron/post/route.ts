import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  isKvEnabled,
  markStoryAsPosted,
  wasStoryPosted
} from "@/lib/dedup";
import { getGoogleTrendSignalsForStories } from "@/lib/google-trends";
import { getLatestNews } from "@/lib/news";
import { chooseStoryForPosting, generatePost } from "@/lib/post-generator";
import { postToTwitter } from "@/lib/twitter";
import { NewsStory } from "@/lib/types";

const warningHookKey = "__xbot_warning_hook_installed__";
export const runtime = "nodejs";

if (!(globalThis as Record<string, unknown>)[warningHookKey]) {
  process.on("warning", (warning) => {
    console.warn("[xbot][node-warning]", {
      name: warning.name,
      code: (warning as Error & { code?: string }).code,
      message: warning.message,
      stack: warning.stack
    });
  });

  (globalThis as Record<string, unknown>)[warningHookKey] = true;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const runId = crypto.randomUUID();
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  console.log("[xbot][cron] start", {
    runId,
    kvEnabled: isKvEnabled(),
    hasCronSecret: Boolean(cronSecret),
    hasAuthHeader: Boolean(authHeader)
  });

  if (cronSecret) {
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn("[xbot][cron] unauthorized", { runId });
      return unauthorized();
    }
  }

  try {
    const stories = await getLatestNews();
    console.log("[xbot][cron] stories fetched", { runId, count: stories.length });

    const unpostedStories: NewsStory[] = [];
    for (const story of stories) {
      const alreadyPosted = await wasStoryPosted(story.url);
      console.log("[xbot][cron] dedup check", {
        runId,
        url: story.url,
        alreadyPosted
      });

      if (!alreadyPosted) {
        unpostedStories.push(story);
      }
    }

    if (unpostedStories.length === 0) {
      console.log("[xbot][cron] no new stories", { runId });
      return NextResponse.json(
        {
          ok: true,
          message: "No new stories available. Nothing posted.",
          kvEnabled: isKvEnabled(),
          runId
        },
        { status: 200 }
      );
    }

    const trendSignals = await getGoogleTrendSignalsForStories(unpostedStories);
    const selection = await chooseStoryForPosting(unpostedStories, trendSignals);
    const selectedStory = selection.story;

    console.log("[xbot][cron] selected story", {
      runId,
      source: selectedStory.source,
      title: selectedStory.title,
      url: selectedStory.url,
      reason: selection.reason,
      trendScore: selection.trendScore,
      matchedTrendTitles: selection.matchedTrendTitles
    });

    const text = await generatePost(selectedStory);
    console.log("[xbot][cron] generated post", {
      runId,
      length: text.length,
      preview: text.slice(0, 140)
    });

    const tweet = await postToTwitter(text);
    console.log("[xbot][cron] posted tweet", {
      runId,
      tweetId: tweet.id,
      mediaCount: 0,
      cardStyleExpected: true
    });

    await markStoryAsPosted(selectedStory.url);
    console.log("[xbot][cron] marked posted", { runId, url: selectedStory.url });

    return NextResponse.json({
      ok: true,
      postedStoryUrl: selectedStory.url,
      postText: text,
      tweetId: tweet.id,
      mediaAttached: false,
      sourceReplyPosted: false,
      storySelectionReason: selection.reason,
      trendScore: selection.trendScore,
      matchedTrendTitles: selection.matchedTrendTitles,
      kvEnabled: isKvEnabled(),
      runId
    });
  } catch (error) {
    console.error("[xbot][cron] failed", {
      runId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json(
      {
        ok: false,
        runId,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
