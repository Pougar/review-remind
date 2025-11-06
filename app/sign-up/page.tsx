// app/sign-up/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/app/lib/auth-client";
import { APP_NAME, ROUTES, API, PASSWORD } from "@/app/lib/constants";

/* ======================== NEW: Site background ======================== */
function BackgroundSea() {
  // fixed, covers entire viewport; very pale blue gradient + blurred blobs
  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      {/* base gentle vertical gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-50 via-sky-50/70 to-white" />
      {/* soft blurred shapes (like distant sea/light) */}
      <div className="absolute -top-24 -left-32 h-80 w-80 rounded-full bg-sky-200/35 blur-3xl" />
      <div className="absolute top-40 -right-24 h-72 w-72 rounded-full bg-indigo-200/30 blur-3xl" />
      <div className="absolute bottom-[-6rem] left-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-200/25 blur-[90px]" />
      {/* subtle grain for depth (very faint) */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(transparent 0, rgba(0,0,0,.07) 100%)",
          backgroundSize: "2px 2px",
        }}
      />
    </div>
  );
}

// Safe error-to-string helper
function errorMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}


/* ======================== Stars + Mini Review Card ======================== */
function Star({
  className = "",
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={className}
      width={size}
      height={size}
    >
      <path
        d="M10 1.5l2.7 5.48 6.05.88-4.38 4.27 1.03 6.02L10 15.85 4.6 18.15l1.03-6.02L1.25 7.86l6.05-.88L10 1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function Stars5({
  size = 14,
  className = "text-amber-500",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-0.5" aria-label="5 out of 5 stars">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={className} size={size} />
      ))}
    </div>
  );
}

function ReviewMiniCard({
  author = "Alex M.",
  text = "Amazing service — quick and friendly!",
  rating = 5,
  className = "",
}: {
  author?: string;
  text?: string;
  rating?: 4 | 5;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-white px-3 py-2 shadow-xl ring-1 ring-black/5 w-[220px] ${className}`}
    >
      <div className="flex items-center justify-between">
        <Stars5 />
        <span className="text-[11px] text-gray-500">{rating.toFixed(1)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-gray-800">{text}</p>
      <div className="mt-1 text-[11px] text-gray-500">— {author}</div>
    </div>
  );
}

function ReviewsSprinklesRight() {
  // Foreground (sharp)
  const fg = [
    { author: "Priya N.", text: "So easy to book and the team was lovely.", rating: 5 as const, style: { top: "9%", left: "12%" }, rot: "rotate-3", scale: "scale-100", anim: "card-float-slow" },
    { author: "Mark L.", text: "Five stars! Clear explanations and quick turnaround.", rating: 5 as const, style: { top: "20%", left: "58%" }, rot: "-rotate-3", scale: "scale-95", anim: "card-float-fast" },
    { author: "Amelia R.", text: "Professional and friendly from start to finish.", rating: 5 as const, style: { top: "34%", left: "28%" }, rot: "rotate-6", scale: "scale-105", anim: "card-float-med" },
    { author: "Hassan K.", text: "Great value and excellent communication.", rating: 5 as const, style: { top: "46%", left: "66%" }, rot: "-rotate-2", scale: "scale-100", anim: "card-float-slow" },
    { author: "Sofia D.", text: "On-time appointment and super helpful.", rating: 5 as const, style: { top: "60%", left: "18%" }, rot: "-rotate-6", scale: "scale-95", anim: "card-float-med" },
    { author: "James O.", text: "Listened carefully and explained everything.", rating: 5 as const, style: { top: "70%", left: "58%" }, rot: "rotate-2", scale: "scale-100", anim: "card-float-fast" },
    { author: "Hannah L.", text: "Modern equipment and a comfortable experience.", rating: 5 as const, style: { top: "12%", left: "74%" }, rot: "rotate-12", scale: "scale-90", anim: "card-float-med" },
    { author: "Diego A.", text: "Quick turnaround — highly recommend!", rating: 5 as const, style: { top: "38%", left: "6%" }, rot: "-rotate-12", scale: "scale-100", anim: "card-float-slow" },
    { author: "Maya C.", text: "Clean facility and easy booking.", rating: 5 as const, style: { top: "78%", left: "9%" }, rot: "rotate-1", scale: "scale-105", anim: "card-float-fast" },
    { author: "Luca B.", text: "Follow-up care was fantastic.", rating: 5 as const, style: { top: "82%", left: "70%" }, rot: "-rotate-3", scale: "scale-95", anim: "card-float-med" },
  ];

  // Mid-far layer (more blurred, dimmer)
  const midFar = [
    { author: "Ava T.", text: "Friendly staff, will return!", style: { top: "6%", left: "45%" }, rot: "-rotate-2" },
    { author: "Noah P.", text: "Parking was easy and close.", style: { top: "28%", left: "78%" }, rot: "rotate-2" },
    { author: "Leo V.", text: "Excellent communication!", style: { top: "55%", left: "36%" }, rot: "-rotate-3" },
    { author: "Zara P.", text: "No wait time — amazing.", style: { top: "72%", left: "84%" }, rot: "rotate-1" },
  ];

  // NEW: Mid-near layer (slightly blurry, less than mid-far)
  const midNear = [
    { author: "Oliver W.", text: "Easy booking and clear next steps.", style: { top: "15%", left: "30%" }, rot: "rotate-1" },
    { author: "Nina S.", text: "They went above and beyond.", style: { top: "48%", left: "80%" }, rot: "-rotate-1" },
    { author: "Kai M.", text: "Follow-up care was thoughtful.", style: { top: "68%", left: "44%" }, rot: "rotate-2" },
    { author: "Isla J.", text: "Super friendly and professional.", style: { top: "86%", left: "22%" }, rot: "-rotate-2" },
  ];

  // Deep layer (heavily blurred, very faint — just depth cues)
  const deep = [
    { author: "Hidden 1", text: "Outstanding experience.", style: { top: "14%", left: "88%" }, rot: "-rotate-6" },
    { author: "Hidden 2", text: "Highly recommend.", style: { top: "64%", left: "6%" }, rot: "rotate-6" },
  ];

  return (
    <div className="relative hidden lg:block min-h-[100svh]">
      {/* Deep layer */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {deep.map((c, i) => (
          <div key={`deep-${i}`} className="absolute blur-3xl opacity-20 scale-[1.15]" style={c.style as React.CSSProperties}>
            <div className={`origin-center ${c.rot}`}>
              <ReviewMiniCard author={c.author} text={c.text} rating={5} />
            </div>
          </div>
        ))}
      </div>

      {/* Mid-far layer */}
      <div className="absolute inset-0 pointer-events-none z-10">
        {midFar.map((c, i) => (
          <div key={`midfar-${i}`} className="absolute blur-sm opacity-60 scale-[1.05] card-float-slow" style={c.style as React.CSSProperties}>
            <div className={`origin-center ${c.rot}`}>
              <ReviewMiniCard author={c.author} text={c.text} rating={5} />
            </div>
          </div>
        ))}
      </div>

      {/* NEW: Mid-near layer (less blurred than mid-far) */}
      <div className="absolute inset-0 pointer-events-none z-[15]">
        {midNear.map((c, i) => (
          <div
            key={`midnear-${i}`}
            className="absolute blur-[2px] opacity-75 scale-[1.02] card-float-med"
            style={c.style as React.CSSProperties}
          >
            <div className={`origin-center ${c.rot}`}>
              <ReviewMiniCard author={c.author} text={c.text} rating={5} />
            </div>
          </div>
        ))}
      </div>

      {/* Foreground (crisp) */}
      <div className="absolute inset-0 pointer-events-none z-20">
        {fg.map((c, i) => (
          <div key={`fg-${i}`} className={`absolute ${c.anim}`} style={c.style as React.CSSProperties}>
            <div className={`origin-center ${c.rot} ${c.scale}`}>
              <ReviewMiniCard author={c.author} text={c.text} rating={c.rating} />
            </div>
          </div>
        ))}
      </div>

      {/* Copyright stamp */}
      <div className="absolute bottom-4 right-6 text-xs text-slate-500 z-30">
        © {new Date().getFullYear()}{" "}
        <span className="font-medium text-slate-700">{APP_NAME}</span>
      </div>

      {/* subtle floating animations */}
      <style jsx>{`
        @keyframes floaty {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        .card-float-slow { animation: floaty 8.5s ease-in-out infinite; }
        .card-float-med  { animation: floaty 6.5s ease-in-out infinite; }
        .card-float-fast { animation: floaty 5.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
}


/* ======================== PAGE ======================== */
export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState(""); // used as display_name
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const passwordsMismatch = password !== password2 && !!password2;
  const disabled =
    loading ||
    !email ||
    !username ||
    !password ||
    !password2 ||
    password.length < PASSWORD.MIN_LEN ||
    passwordsMismatch;

  const redirectToDashboard = (slug?: string) => {
    if (slug) {
      router.push(`${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}`);
    } else {
      router.push(ROUTES.DASHBOARD); // server will resolve/redirect to user slug
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  setError("");
  if (disabled) return;

  const cleanEmail = email.trim().toLowerCase();
  const cleanName  = username.trim();

  setLoading(true);
  try {
    const { error: signUpErr } = await authClient.signUp.email(
      { email: cleanEmail, password, name: cleanName },
      {
        onSuccess: async (ctx) => {
          const user = ctx.data?.user;
          if (!user?.id) {
            setError("Unexpected error finalizing your account.");
            setLoading(false);
            return;
          }
          // ✅ Create/find myusers row and get slug in one step
          try {
            const r = await fetch(API.SIGN_UP, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: user.id, email: cleanEmail, name: cleanName }),
            });
            if (!r.ok) {
              const msg = await r.text().catch(() => "");
              throw new Error(msg || "Could not finalize your account.");
            }
            const { slug } = (await r.json()) as { slug?: string };

            const b = await fetch(API.RECORD_SIGN_UP, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: user.id }),
            });
            if (!b.ok) {
              const msg = await b.text().catch(() => "");
              throw new Error(msg || "Could not finalize your account.");
            }

            redirectToDashboard(slug);
          } catch (_err: unknown) {
            // Safety fallback — still go to /dashboard (server can re-resolve)
            redirectToDashboard();
          } finally {
            setLoading(false);
          }
        },
        onError: (ctx) => {
          setError(ctx.error?.message || "Sign up failed. Please try again.");
          setLoading(false);
        },
      }
    );

    if (signUpErr) {
      setError(signUpErr.message || "Sign up failed. Please try again.");
    }
  } catch (err: unknown) {
    setError(errorMsg(err));
  } finally {
    setLoading(false);
  }
};


  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      <BackgroundSea />
      {/* LEFT: Form column */}
      <div className="relative flex min-h-screen items-center">
        {/* Top nav */}
        <div className="absolute left-6 top-6 flex items-center gap-3">
          <Link
            href={ROUTES.HOME}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M10 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 12h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Back
          </Link>
          <span className="ml-2 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            {APP_NAME}
          </span>
        </div>

        <div className="mx-auto w-full max-w-md px-6">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Welcome to {APP_NAME}!
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Sign up to start collecting and understanding reviews.
            </p>
          </header>

          {(error || passwordsMismatch) && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
              <div className="flex items-start gap-2">
                <svg className="mt-0.5 h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7v6m0 4h.01" stroke="currentColor" strokeWidth="2" />
                </svg>
                <div className="space-y-1">
                  {error ? <p>{error}</p> : null}
                  {passwordsMismatch ? <p>Passwords do not match.</p> : null}
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSignUpSubmit} className="space-y-4" noValidate>
            {/* Username */}
            <div>
              <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                New password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                aria-invalid={password.length > 0 && password.length < PASSWORD.MIN_LEN}
              />
            </div>

            {/* Confirm password */}
            <div>
              <label htmlFor="password2" className="mb-1 block text-sm font-medium text-slate-700">
                Confirm password
              </label>
              <input
                id="password2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                aria-invalid={passwordsMismatch}
                aria-describedby={passwordsMismatch ? "pwd-mismatch" : undefined}
              />
              <p className="mt-2 text-xs text-slate-500">
                Your password must contain at least {PASSWORD.MIN_LEN} characters.
              </p>
              {passwordsMismatch && (
                <p id="pwd-mismatch" className="mt-1 text-xs text-amber-700">
                  Passwords do not match.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={disabled}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                  </svg>
                  Signing up…
                </>
              ) : (
                "Continue"
              )}
            </button>

            <p className="text-sm text-slate-600">
              Already have an account?{" "}
              <Link href={ROUTES.LOG_IN} className="font-medium text-slate-900 underline-offset-4 hover:underline">
                Log in
              </Link>
            </p>

            <p className="pt-2 text-xs text-slate-500">
              By signing up for an {APP_NAME} account, you agree to our{" "}
              <span className="underline">Privacy Policy</span> and{" "}
              <span className="underline">Terms of Service</span>.
            </p>
          </form>
        </div>
      </div>

      {/* RIGHT: Layered, sprinkled 5-star reviews with depth */}
      <ReviewsSprinklesRight />
    </main>
  );
}
