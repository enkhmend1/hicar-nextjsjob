import type { Metadata } from "next";
import "./globals.css";
import AIChatWidget from "./components/AIChatWidget";
import SessionBoot from "./components/SessionBoot";

export const metadata: Metadata = {
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
      </body>
    </html>
  );
}
