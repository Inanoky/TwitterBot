import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";
const socialImageUrl = process.env.NEXT_PUBLIC_SOCIAL_IMAGE_URL || `${siteUrl}/og-image.jpg`;

export const metadata: Metadata = {
  title: "AI Construction X Bot",
  description: "Automated X/Twitter bot posting AI + construction trend updates every 2 hours",
  openGraph: {
    title: "AI Construction X Bot",
    description: "Automated X/Twitter bot posting AI + construction trend updates every 2 hours",
    url: siteUrl,
    images: [{ url: socialImageUrl }]
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Construction X Bot",
    description: "Automated X/Twitter bot posting AI + construction trend updates every 2 hours",
    images: [socialImageUrl]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
