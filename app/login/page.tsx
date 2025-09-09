"use client";

import { useState } from "react";
import Link from "next/link";

export default function Login() {

    const [emailValue, setEmailValue] = useState(""); // state to hold input
    const [passValue, setPassInput] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        setLoading(true);
        setMessage('');
        try {
            const res = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ emailValue, passValue }),
            });
            const data = await res.json();
            setMessage(data.message);
          } catch (err) {
            setMessage('An error occurred. Please try again.');
          } finally {
            setLoading(false); // re-enable button
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
            <div className="relative bg-gray-200 dark:bg-gray-700 rounded-lg shadow-lg w-110 h-80 flex flex-col items-center justify-center gap-10">
                <h1 className="text-3xl font-semibold text-gray-800 dark:text-gray-100">Login</h1>
                <div className="flex flex-col items-center gap-6">
                    <input
                    type="text"
                    value={emailValue} // value comes from state
                    onChange={(e) => setEmailValue(e.target.value)} // update state on change
                    placeholder="Email"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <input
                    type="text"
                    value={passValue} // value comes from state
                    onChange={(e) => setPassInput(e.target.value)} // update state on change
                    placeholder="Password"
                    className="border rounded px-3 py-2 w-64"
                    />
                </div>
                <button 
                    onClick={handleLogin}
                    disabled={loading}
                    className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500'}"
                    >
                    {loading ? 'Logging in...' : 'Login'}
                </button>
                {message && <p>{message}</p>}
            </div>
        </main>
    );

}