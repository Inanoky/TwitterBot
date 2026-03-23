import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  isKvEnabled,
  markTweetLiked,
  markUserFollowed,
  wasTweetLiked,
  wasUserFollowed
} from "@/lib/dedup";
import { followUser, likeTweet, searchRecentTweets } from "@/lib/twitter";
import { TwitterSearchPost } from "@/lib/types";

export const runtime = "nodejs";

const ENGAGEMENT_QUERY = '("ai construction" OR "construction ai" OR "jobsite ai" OR "construction robotics" OR "aec ai" OR "infrastructure ai") -is:retweet -is:reply lang:en';
const MIN_AUTHOR_FOLLOWERS = 300;
const MAX_AUTHOR_FOLLOWERS = 50000;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function scorePost(post: TwitterSearchPost): number {
  const velocity = post.likeCount + post.retweetCount * 2 + post.replyCount * 2 + post.quoteCount * 2;
  const authorQualityBoost = post.authorFollowersCount ? Math.min(post.authorFollowersCount / 1000, 15) : 0;
  const verifiedBoost = post.authorVerified ? 5 : 0;
  return velocity + authorQualityBoost + verifiedBoost;
}

function shouldFollowAuthor(post: TwitterSearchPost): boolean {
  if (!post.authorId || !post.authorFollowersCount) {
    return false;
  }

  return post.authorFollowersCount >= MIN_AUTHOR_FOLLOWERS && post.authorFollowersCount <= MAX_AUTHOR_FOLLOWERS;
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
    const rankedPosts = posts.sort((a, b) => scorePost(b) - scorePost(a));

    let targetPost: TwitterSearchPost | null = null;
    for (const post of rankedPosts) {
      const alreadyLiked = await wasTweetLiked(post.id);
      if (!alreadyLiked) {
        targetPost = post;
        break;
      }
    }

    if (!targetPost) {
      return NextResponse.json({
        ok: true,
        message: "No new relevant posts found for audience growth.",
        kvEnabled: isKvEnabled(),
        runId
      });
    }

    await likeTweet(targetPost.id);
    await markTweetLiked(targetPost.id);

    let followedAuthor = false;
    if (shouldFollowAuthor(targetPost) && targetPost.authorId) {
      const alreadyFollowed = await wasUserFollowed(targetPost.authorId);
      if (!alreadyFollowed) {
        await followUser(targetPost.authorId);
        await markUserFollowed(targetPost.authorId);
        followedAuthor = true;
      }
    }

    return NextResponse.json({
      ok: true,
      growthAction: "liked_relevant_post",
      targetTweetId: targetPost.id,
      targetTweetUrl: targetPost.url,
      targetAuthorUsername: targetPost.authorUsername,
      targetAuthorFollowers: targetPost.authorFollowersCount,
      followedAuthor,
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
