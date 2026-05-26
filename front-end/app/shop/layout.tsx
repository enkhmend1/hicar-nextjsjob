import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Бүх сэлбэгүүд · HiCar MN",
  description: "Японы оригинал OEM авто сэлбэгийн каталог — Toyota, Nissan, Honda, Hyundai зэрэг. Үнэ харьцуулах, шүүлт, шуурхай хайлт.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
