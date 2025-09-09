"use client";

import { useState } from "react";
import Link from "next/link";

export default function Signup() {

    const [inputValue, setInputValue] = useState(""); // state to hold input
    const [secondInput, setSecondInput] = useState("");
    const [thirdInput, setThirdInput] = useState("");
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
                    value={inputValue} // value comes from state
                    onChange={(e) => setInputValue(e.target.value)} // update state on change
                    placeholder="Email"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">New Password</h1>
                    <input
                    type="text"
                    value={secondInput} // value comes from state
                    onChange={(e) => setSecondInput(e.target.value)} // update state on change
                    placeholder="Password"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <input
                    type="text"
                    value={thirdInput} // value comes from state
                    onChange={(e) => setThirdInput(e.target.value)} // update state on change
                    placeholder="Password Again"
                    className="border rounded px-3 py-2 w-64"
                    />
                    <Link 
                        href="/"
                        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
                        >
                        Signup
                    </Link>
                </div>
            </div>
        </main>
    );

}