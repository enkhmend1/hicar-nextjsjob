import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Миний машинууд · HiCar MN",
  description: "Та бүртгэсэн автомашин дээрээ тохирох сэлбэгийг шууд олох — гараж + улсын дугаар + chassis удирдлага.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
