import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Construction X Bot",
  description: "Automated X/Twitter bot posting AI + construction trend updates every 2 hours"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
