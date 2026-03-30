import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  isKvEnabled,
  markTweetLiked,
  markUserFollowed,
  wasTweetLiked,
  wasUserFollowed
} from "@/lib/dedup";
import { generateEngagementReply } from "@/lib/post-generator";
import { followUser, likeTweet, postToTwitter, searchRecentTweets } from "@/lib/twitter";
import { TwitterSearchPost } from "@/lib/types";

export const runtime = "nodejs";

const ENGAGEMENT_QUERY = '("ai construction" OR "construction ai" OR "jobsite ai" OR "construction robotics" OR "aec ai" OR "infrastructure ai") -is:retweet -is:reply lang:en';
const MIN_AUTHOR_FOLLOWERS = 300;
const MAX_AUTHOR_FOLLOWERS = 50000;
const ENGAGEMENT_TARGET_USERNAME = (process.env.ENGAGEMENT_TARGET_USERNAME || "BuildWitt").trim();

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

  console.log("[xbot][engage] start", {
    runId,
    kvEnabled: isKvEnabled(),
    hasCronSecret: Boolean(cronSecret),
    hasAuthHeader: Boolean(authHeader)
  });

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[xbot][engage] unauthorized", { runId });
    return unauthorized();
  }

  try {
    const targetQuery = `from:${ENGAGEMENT_TARGET_USERNAME} ${ENGAGEMENT_QUERY}`;
    const posts = await searchRecentTweets(targetQuery, 20);
    console.log("[xbot][engage] posts fetched", {
      runId,
      targetUsername: ENGAGEMENT_TARGET_USERNAME,
      count: posts.length,
      topCandidates: posts.slice(0, 5).map((post) => ({
        id: post.id,
        authorUsername: post.authorUsername,
        likeCount: post.likeCount,
        replyCount: post.replyCount,
        quoteCount: post.quoteCount,
        followers: post.authorFollowersCount,
        url: post.url
      }))
    });

    const rankedPosts = posts.sort((a, b) => scorePost(b) - scorePost(a));

    let targetPost: TwitterSearchPost | null = null;
    for (const post of rankedPosts) {
      const alreadyLiked = await wasTweetLiked(post.id);
      console.log("[xbot][engage] candidate check", {
        runId,
        tweetId: post.id,
        authorUsername: post.authorUsername,
        score: scorePost(post),
        alreadyLiked,
        url: post.url
      });

      if (!alreadyLiked) {
        targetPost = post;
        break;
      }
    }

    if (!targetPost) {
      console.log("[xbot][engage] no target post found", { runId });
      return NextResponse.json({
        ok: true,
        message: `No new relevant posts found for target account @${ENGAGEMENT_TARGET_USERNAME}.`,
        kvEnabled: isKvEnabled(),
        runId
      });
    }

    console.log("[xbot][engage] selected target", {
      runId,
      tweetId: targetPost.id,
      authorId: targetPost.authorId,
      authorUsername: targetPost.authorUsername,
      authorFollowersCount: targetPost.authorFollowersCount,
      shouldFollow: shouldFollowAuthor(targetPost),
      url: targetPost.url
    });

    await likeTweet(targetPost.id);
    await markTweetLiked(targetPost.id);
    console.log("[xbot][engage] tweet liked", {
      runId,
      tweetId: targetPost.id,
      url: targetPost.url
    });

    const replyText = await generateEngagementReply(targetPost);
    const replyTweet = await postToTwitter(replyText, { replyToTweetId: targetPost.id });
    console.log("[xbot][engage] reply posted", {
      runId,
      replyTweetId: replyTweet.id,
      targetTweetId: targetPost.id
    });

    let followedAuthor = false;
    let followsThisRun = 0;
    if (shouldFollowAuthor(targetPost) && targetPost.authorId) {
      const alreadyFollowed = await wasUserFollowed(targetPost.authorId);
      console.log("[xbot][engage] follow check", {
        runId,
        authorId: targetPost.authorId,
        authorUsername: targetPost.authorUsername,
        alreadyFollowed
      });

      if (!alreadyFollowed && followsThisRun < 1) {
        await followUser(targetPost.authorId);
        await markUserFollowed(targetPost.authorId);
        followedAuthor = true;
        followsThisRun += 1;
        console.log("[xbot][engage] author followed", {
          runId,
          authorId: targetPost.authorId,
          authorUsername: targetPost.authorUsername
        });
      }
    } else {
      console.log("[xbot][engage] follow skipped", {
        runId,
        authorId: targetPost.authorId,
        authorUsername: targetPost.authorUsername,
        authorFollowersCount: targetPost.authorFollowersCount
      });
    }

    console.log("[xbot][engage] completed", {
      runId,
      tweetId: targetPost.id,
      followedAuthor,
      followsThisRun,
      replyTweetId: replyTweet.id
    });

    return NextResponse.json({
      ok: true,
      growthAction: "liked_relevant_post_and_replied",
      targetUsername: ENGAGEMENT_TARGET_USERNAME,
      targetTweetId: targetPost.id,
      targetTweetUrl: targetPost.url,
      targetAuthorUsername: targetPost.authorUsername,
      targetAuthorFollowers: targetPost.authorFollowersCount,
      replyTweetId: replyTweet.id,
      replyText,
      followedAuthor,
      followsThisRun,
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
