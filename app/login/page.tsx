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
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
    
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
    };

    return (
      <main className="min-h-screen flex items-center justify-center">
        <Link 
            href="/"
            className="absolute top-4 left-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
            >
            Back
        </Link>
        <form onSubmit={handleSubmit}>
          <div className="relative bg-gray-200 dark:bg-gray-700 rounded-lg shadow-lg w-96 h-64 flex flex-col items-center justify-center">
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Log In</h1>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button 
              type="submit" 
              disabled={!email || !password}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
              >
              Log In
              </button>
              {error && <p style={{ color: "red" }}>{error}</p>}
            </div>
        </form>
          <Link href="/signup" className="hover:underline">Don&apos;t have an account yet?{" "}Click here to sign up.</Link>

      </main>
      );

}