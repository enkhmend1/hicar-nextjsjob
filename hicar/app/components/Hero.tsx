"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SearchCard from "./SearchCard";
export default function Hero() {
  const [user, setUser] = useState<{ name: string } | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    setUser(storedUser ? JSON.parse(storedUser) : null);
  }, []);

  return (
    <section className="hero-gradient px-6 pt-12 pb-9">
      <div className="max-w-6xl mx-auto">

        <div className="inline-flex items-center gap-1.5 bg-violet-100 text-violet-600 text-[11px] font-medium px-3 py-1 rounded-full mb-5">
          AI-д суурилсан хайлт
        </div>

        <h1 className="text-4xl sm:text-5xl font-semibold text-gray-900 leading-tight mb-3">
          Машиндаа яг таарах<br />
          сэлбэгийг <em className="text-violet-600 not-italic">AI</em>-аар<br />
          хурдан ол.
        </h1>

        <p className="text-[15px] text-gray-500 mb-7 max-w-lg">
          Марк, загвар, он оруулаад л — AI сэлбэгийг олно.
        </p>

        {/* 🔥 CONDITIONAL BUTTONS */}
        {!user && (
          <div className="flex flex-col sm:flex-row gap-2.5 mb-9">
            <Link
              href="/auth/login"
              className="bg-violet-600 text-white rounded-lg px-6 py-2.5 text-sm font-medium"
            >
              Нэвтрэх
            </Link>

            <Link
              href="/auth/register"
              className="border border-gray-300 text-gray-700 rounded-lg px-6 py-2.5 text-sm"
            >
              Бүртгүүлэх
            </Link>
          </div>
        )}
         <SearchCard />
      </div> 
    </section>
  );
}