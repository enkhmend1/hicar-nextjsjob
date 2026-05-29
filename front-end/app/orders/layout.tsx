import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Захиалга · HiCar MN",
  description: "Таны захиалгын түүх, төлөв болон маргааны хяналт.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
