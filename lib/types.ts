export type NewsStory = {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
};

export type TwitterSearchPost = {
  id: string;
  text: string;
  authorId?: string;
  authorUsername?: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  impressionCount?: number;
  createdAt: string;
  url: string;
};

export type StorySelection = {
  story: NewsStory;
  reason: string;
  relatedPosts: TwitterSearchPost[];
};
