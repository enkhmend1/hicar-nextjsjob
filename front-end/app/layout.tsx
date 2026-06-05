import type { Metadata } from "next";
import "./globals.css";
import AIChatWidget from "./components/AIChatWidget";
import SessionBoot from "./components/SessionBoot";
import Toaster from "./components/Toaster";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://hicar.mn"),
  title: "HiCar MN — Автомашины сэлбэг",
  description: "Монголын №1 авто сэлбэгийн онлайн дэлгүүр. Japan OEM сэлбэг.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn">
      <body className="bg-gray-50 text-gray-900 min-h-screen antialiased">
        <SessionBoot />
        {children}
        <AIChatWidget />
        {/* Phase V.1: app-wide toast container. Any client component
            can fire `toast.success("...")` and have it appear here. */}
        <Toaster />
      </body>
    </html>
  );
}
