import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f0e7",
};

const title = "Barkoff — Real People. Real Barks. One Top Dog.";
const description =
  "Get matched with a real rival anywhere in the world, join a live peer-to-peer video bark-off, and climb the global Elo leaderboard.";
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const metadataBase = new URL(
  productionHost ? `https://${productionHost}` : "http://localhost:3000",
);

export const metadata: Metadata = {
  metadataBase,
  title,
  description,
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title,
    description,
    siteName: "Barkoff",
    images: [
      {
        url: "/og.png",
        width: 1536,
        height: 1024,
        alt: "Barkoff live barking battle",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
