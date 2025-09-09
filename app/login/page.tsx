"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Login() {

    const [email, setEmail] = useState(""); // state to hold input
    const [password, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const result = await signIn("credentials", {
          redirect: false,
          email,
          password,
        });

    if (result?.error) {
        setError("Invalid email or password");
        } else {
        router.push("/dashboard"); // redirect after successful login
        }
      setLoading(false);
    };

    return (
      <main className="min-h-screen flex flex-col items-center justify-center">
        <Link 
            href="/"
            className="absolute top-4 left-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
            >
            Back
        </Link>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <form onSubmit={handleSubmit} className="gap-2">
          <div className="relative bg-gray-200 dark:bg-gray-700 rounded-lg shadow-lg w-96 h-70 flex flex-col items-center justify-center gap-6">
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Log In</h1>
              <input
                type="email"
                placeholder="Email"
                value={email}
                className="border rounded px-3 py-2 w-64"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                className="border rounded px-3 py-2 w-64"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button 
              type="submit" 
              disabled={!email || !password || loading}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
              >
              {loading ? "Logging in..." : "Log in"}
              </button>
            </div>
        </form>
          <Link href="/signup" className="hover:underline">Don&apos;t have an account yet?{" "}Click here to sign up</Link>

      </main>
      );

}