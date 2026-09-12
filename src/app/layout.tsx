import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionGuard } from "@/components/motion-guard";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NimDares - Stake your commitment on-chain",
  description:
    "Decentralized goal-staking for Nimiq Pay. Stake NIM or USDT on a personal dare, prove it with AI or real API evidence, and let the escrow settle automatically.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MotionGuard>{children}</MotionGuard>
      </body>
    </html>
  );
}