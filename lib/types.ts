export type NewsStory = {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
};

export type PexelsImageSelection = {
  imageUrl: string;
  photoId: string;
  photographer: string | null;
};
