import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Улсын дугаараар хайх · HiCar MN",
  description: "Машины улсын дугаараар хөдөлгүүр, шасси, тохирох сэлбэгүүдийг шууд олох.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
