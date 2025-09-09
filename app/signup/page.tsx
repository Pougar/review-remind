"use client";

import { useState } from "react";
import Link from "next/link";

export default function Signup() {

    const [emailValue, setEmailValue] = useState(""); // state to hold input
    const [passValue, setPassInput] = useState("");
    const [pass2Value, setPass2Input] = useState("");
    const [message, setMessage] = useState("");
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSignup = async () => {
        setLoading(true);
        setMessage('');
        try {
            const res = await fetch('/api/signin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ emailValue, passValue }),
            });
            const data = await res.json();
            setMessage(data.message);
            setSuccess(data.success);
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
            <div className="relative bg-gray-200 dark:bg-gray-700 rounded-lg shadow-lg w-110 h-100 flex items-center justify-center">
                <div className="flex flex-col items-center gap-6">
                    <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Sign Up</h1>
                    <input
                    type="text"
                    value={emailValue} // value comes from state
                    onChange={(e) => setEmailValue(e.target.value)} // update state on change
                    placeholder="Email"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">New Password</h1>
                    <input
                    type="password"
                    value={passValue} // value comes from state
                    onChange={(e) => setPassInput(e.target.value)} // update state on change
                    placeholder="Password"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <input
                    type="password"
                    value={pass2Value} // value comes from state
                    onChange={(e) => setPass2Input(e.target.value)} // update state on change
                    placeholder="Password Again"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <div className="flex flex-col items-center gap-5">
                        <button
                            onClick={handleSignup}
                            disabled={loading || !emailValue || !passValue || passValue !== pass2Value}
                            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
                            >
                            Signup
                        </button>
                        {message && (<p className={success ? "text-blue-600 font-semibold" : "text-red-600 font-semibold"}>{message}</p>)}
                    </div>
                </div>
            </div>
        </main>
    );

}