"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
 const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();

  setLoading(true);

  try {
    const storedUser = localStorage.getItem("user");

    if (!storedUser) {
      alert("Хэрэглэгч олдсонгүй");
      return;
    }

    const parsedUser = JSON.parse(storedUser);

    if (
  parsedUser.email === email &&
  parsedUser.password === password
) {
  router.push("/");
} else {
  alert("Email эсвэл password буруу байна");
}
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
          Login
        </h1>

        <p className="text-gray-500 mt-2">
          HiCar account руугаа нэвтэрнэ үү
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label className="block mb-2 font-medium text-gray-700">
            Email
          </label>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@gmail.com"
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
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
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-violet-600 hover:bg-violet-900 text-white py-3 rounded-2xl font-semibold transition"
        >
          {loading ? "Loading..." : "Login"}
        </button>
      </form>

      <p className="text-center text-gray-500 mt-6">
        Account байхгүй юу?{" "}
        <Link
          href="/auth/register"
          className="text-violet-600    font-semibold"
        >
          Register
        </Link>
      </p>
    </div>
  );
}