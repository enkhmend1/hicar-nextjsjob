import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HiCar MN — Автомашины сэлбэг",
  description: "Машиндаа яг таарах сэлбэгийг AI-аар хурдан ол. Japan OEM сэлбэг.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="mn">
      <body className="bg-gray-50 text-gray-900 min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
