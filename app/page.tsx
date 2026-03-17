export default function HomePage() {
  return (
    <main>
      <h1>🤖 AI + Construction X Bot</h1>
      <p>
        This Next.js app is built for Vercel Cron to auto-post engaging updates about AI trends in
        construction every 2 hours.
      </p>

      <h2>How it works</h2>
      <ol>
        <li>Vercel Cron calls <code>/api/cron/post</code> every 2 hours.</li>
        <li>The API fetches fresh news from NewsAPI and GNews.</li>
        <li>
          It deduplicates stories against previously posted links, then generates a high-quality
          X post with AI.
        </li>
        <li>It publishes to X/Twitter via OAuth 1.0a.</li>
      </ol>

      <p>
        Configure the required environment variables in Vercel and deploy. See the README for full
        setup details.
      </p>
    </main>
  );
}
