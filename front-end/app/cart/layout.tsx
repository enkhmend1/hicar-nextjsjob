import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Сагс · HiCar MN",
  description: "Захиалга үргэлжлүүлэх — таны сонгосон сэлбэгүүд.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
