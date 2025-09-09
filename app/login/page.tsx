"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Signup() {

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
        <form onSubmit={handleSubmit}>
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
          <button type="submit">Log In</button>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </form>
      );

}