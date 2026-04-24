import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import { AppGnb } from "@/components/AppGnb";
import "./globals.css";

const paperlogySans = localFont({
  variable: "--font-paperlogy-sans",
  display: "swap",
  src: [
    { path: "./fonts/Paperlogy-1Thin.ttf", weight: "100", style: "normal" },
    { path: "./fonts/Paperlogy-2ExtraLight.ttf", weight: "200", style: "normal" },
    { path: "./fonts/Paperlogy-3Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Paperlogy-4Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Paperlogy-5Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Paperlogy-6SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Paperlogy-7Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Paperlogy-8ExtraBold.ttf", weight: "800", style: "normal" },
    { path: "./fonts/Paperlogy-9Black.ttf", weight: "900", style: "normal" },
  ],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function resolveMetadataBaseUrl(): URL {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    "http://localhost:3000";

  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(normalized);
  } catch {
    return new URL("http://localhost:3000");
  }
}

const metadataBase = resolveMetadataBaseUrl();

export const metadata: Metadata = {
  metadataBase,
  title: "철강 수출입 대시보드",
  description: "수출입 공공데이터 시각화 (초기 레이아웃)",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", rel: "shortcut icon", type: "image/x-icon" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${paperlogySans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full min-h-screen flex-col">
        <AppGnb />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
