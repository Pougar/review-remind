"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Signup() {

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
    
        // 1. Create user
        const res = await fetch("/api/signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();
        setLoading(false);
    
        if (!res.ok) {
          setError(data.error || "Signup failed");
          return;
        }
    
        // 2. Auto-login after signup
        const login = await signIn("credentials", {
          redirect: false,
          email,
          password,
        });
    
        if (login?.error) {
          setError("Login after signup failed");
        } else {
          router.push("/dashboard"); // redirect after login
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
            <div className="relative bg-gray-200 dark:bg-gray-700 rounded-lg shadow-lg w-110 h-100 flex items-center justify-center">
                <div className="flex flex-col items-center gap-6">
                    <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Sign Up</h1>
                    <input
                    type="email"
                    value={email} // value comes from state
                    onChange={(e) => setEmail(e.target.value)} // update state on change
                    placeholder="Email"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">New Password</h1>
                    <input
                    type="password"
                    value={password} // value comes from state
                    onChange={(e) => setPassword(e.target.value)} // update state on change
                    placeholder="New Password"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <input
                    type="password"
                    value={password2} // value comes from state
                    onChange={(e) => setPassword2(e.target.value)} // update state on change
                    placeholder="New Password Again"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <div className="flex flex-col items-center gap-5">
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !email || !password || password !== password2}
                            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
                            >
                            Signup
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );

}