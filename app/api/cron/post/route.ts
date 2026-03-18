import { NextRequest, NextResponse } from "next/server";

import { isKvEnabled, markImageAsUsed, markStoryAsPosted, wasStoryPosted } from "@/lib/dedup";
import { getLatestNews } from "@/lib/news";
import { generatePost } from "@/lib/post-generator";
import { getPexelsImage } from "@/lib/pexels";
import { postToTwitter, uploadTwitterMediaFromUrl } from "@/lib/twitter";

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

    let selectedStory = null;
    for (const story of stories) {
      const alreadyPosted = await wasStoryPosted(story.url);
      console.log("[xbot][cron] dedup check", { runId, url: story.url, alreadyPosted });

      if (!alreadyPosted) {
        selectedStory = story;
        break;
      }
    }

    if (!selectedStory) {
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

    console.log("[xbot][cron] selected story", {
      runId,
      source: selectedStory.source,
      title: selectedStory.title,
      url: selectedStory.url
    });

    const text = await generatePost(selectedStory);
    console.log("[xbot][cron] generated post", { runId, length: text.length, preview: text.slice(0, 140) });

    const imageSelection = await getPexelsImage(selectedStory);
    console.log("[xbot][cron] pexels selection", { runId, imageSelection });

    const imageUrl = imageSelection?.imageUrl ?? null;
    let mediaIds: string[] = [];

    if (imageUrl) {
      try {
        const mediaId = await uploadTwitterMediaFromUrl(imageUrl);
        mediaIds = [mediaId];
        console.log("[xbot][cron] media upload success", { runId, imageUrl, mediaId });
      } catch (error) {
        console.error("[xbot][cron] media upload failed", {
          runId,
          imageUrl,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log("[xbot][cron] creating main tweet", { runId, mediaIds, hasImage: Boolean(imageUrl) });
    const tweet = await postToTwitter(text, { mediaIds });
    console.log("[xbot][cron] posted tweet", { runId, tweetId: tweet.id, mediaCount: mediaIds.length });

    const sourceReplyText = `Source: ${selectedStory.url}`;
    const sourceReply = await postToTwitter(sourceReplyText, { replyToTweetId: tweet.id });
    console.log("[xbot][cron] posted source reply", { runId, tweetId: sourceReply.id, parentTweetId: tweet.id });

    await markStoryAsPosted(selectedStory.url);

    if (imageSelection?.photoId) {
      await markImageAsUsed(imageSelection.photoId);
      console.log("[xbot][cron] marked image used", { runId, photoId: imageSelection.photoId });
    }

    console.log("[xbot][cron] marked posted", { runId, url: selectedStory.url });

    return NextResponse.json({
      ok: true,
      postedStoryUrl: selectedStory.url,
      postText: text,
      tweetId: tweet.id,
      sourceReplyPosted: true,
      imageUrl,
      mediaIds,
      imagePhotoId: imageSelection?.photoId ?? null,
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
