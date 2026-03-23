import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { isKvEnabled, markTweetAsEngaged, wasTweetEngaged } from "@/lib/dedup";
import { generateEngagementComment } from "@/lib/post-generator";
import { postToTwitter, searchRecentTweets } from "@/lib/twitter";
import { TwitterSearchPost } from "@/lib/types";

export const runtime = "nodejs";

const ENGAGEMENT_QUERY = '("ai construction" OR "construction ai" OR "jobsite ai" OR "construction robotics" OR "aec ai" OR "infrastructure ai") -is:retweet -is:reply lang:en';

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function scorePost(post: TwitterSearchPost): number {
  return post.likeCount + post.retweetCount * 2 + post.replyCount * 3 + post.quoteCount * 2;
}

export async function GET(request: NextRequest) {
  const runId = crypto.randomUUID();
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  try {
    const posts = await searchRecentTweets(ENGAGEMENT_QUERY, 20);
    const candidates: TwitterSearchPost[] = [];

    for (const post of posts.sort((a, b) => scorePost(b) - scorePost(a))) {
      const alreadyEngaged = await wasTweetEngaged(post.id);
      if (!alreadyEngaged) {
        candidates.push(post);
      }
    }

    const targetPost = candidates[0];

    if (!targetPost) {
      return NextResponse.json({
        ok: true,
        message: "No new relevant posts found for engagement.",
        kvEnabled: isKvEnabled(),
        runId
      });
    }

    const replyText = await generateEngagementComment(targetPost);
    const reply = await postToTwitter(replyText, { replyToTweetId: targetPost.id });
    await markTweetAsEngaged(targetPost.id);

    return NextResponse.json({
      ok: true,
      engagedTweetId: targetPost.id,
      engagedTweetUrl: targetPost.url,
      replyTweetId: reply.id,
      replyText,
      kvEnabled: isKvEnabled(),
      runId
    });
  } catch (error) {
    console.error("[xbot][engage] failed", {
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
