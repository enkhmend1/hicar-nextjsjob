"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
export default function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleRegister = async (e: React.FormEvent) => {
  e.preventDefault();

  setLoading(true);

  try {
    localStorage.setItem(
      "user",
      JSON.stringify({
        name,
        email,
        password,
      })
    );

    router.push("/");
  } catch (error) {
    console.log(error);
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="w-full max-w-md bg-white rounded-3xl shadow-lg p-8 border border-gray-100">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          Create Account
        </h1>

        <p className="text-gray-500 mt-2">
          HiCar дээр шинэ хэрэглэгч үүсгэнэ
        </p>
      </div>

      <form
        onSubmit={handleRegister}
        className="space-y-5"
      >
        <div>
          <label className="block mb-2 font-medium text-gray-700">
            Full Name
          </label>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Нэр"
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-violet-500"
            required
          />
        </div>

        <div>
          <label className="block mb-2 font-medium text-gray-700">
            Email
          </label>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@gmail.com"
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-violet-500"
            required
          />
        </div>

        <div>
          <label className="block mb-2 font-medium text-gray-700">
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-violet-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white py-3 rounded-2xl font-semibold transition"
        >
          {loading ? "Loading..." : "Create Account"}
        </button>
      </form>

      <p className="text-center text-gray-500 mt-6">
        Account байгаа юу?{" "}
        <Link
          href="/auth/login"
          className="text-violet-600 font-semibold"
        >
          Login
        </Link>
      </p>
    </div>
  );
}