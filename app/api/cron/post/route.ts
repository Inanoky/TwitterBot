import { NextRequest, NextResponse } from "next/server";

import { isKvEnabled, markStoryAsPosted, wasStoryPosted } from "@/lib/dedup";
import { getLatestNews } from "@/lib/news";
import { generatePost } from "@/lib/post-generator";
import { postToTwitter } from "@/lib/twitter";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret) {
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return unauthorized();
    }
  }

  try {
    const stories = await getLatestNews();

    let selectedStory = null;
    for (const story of stories) {
      const alreadyPosted = await wasStoryPosted(story.url);
      if (!alreadyPosted) {
        selectedStory = story;
        break;
      }
    }

    if (!selectedStory) {
      return NextResponse.json(
        {
          ok: true,
          message: "No new stories available. Nothing posted.",
          kvEnabled: isKvEnabled()
        },
        { status: 200 }
      );
    }

    const text = await generatePost(selectedStory);
    const tweet = await postToTwitter(text);

    await markStoryAsPosted(selectedStory.url);

    return NextResponse.json({
      ok: true,
      postedStoryUrl: selectedStory.url,
      postText: text,
      tweetId: tweet.id,
      kvEnabled: isKvEnabled()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
