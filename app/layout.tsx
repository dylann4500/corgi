import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Barkoff — Prove You're Top Dog",
  description:
    "A competitive barking arena. Get a prompt, face a rival, and bark for glory.",
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
