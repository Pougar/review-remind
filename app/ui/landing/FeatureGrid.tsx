"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import googleBusiness from "@/app/ui/landing/logos/google-business.png";
import xeroLogo from "@/app/ui/landing/logos/xero.png";
import reviewStar from "@/app/ui/landing/logos/review-star.png";

/* ------------------------------------------------------------------
   Generic hover tile
   - When `bare` is true, we don't render an extra white card; the child
     content itself acts as the box (good for tables with their own outline).
------------------------------------------------------------------- */
function HoverTile({
  children,
  description,
  className = "",
  bare = false,
}: {
  children: (hovered: boolean) => React.ReactNode;
  description: string;
  className?: string;
  bare?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const chrome = bare
    ? "relative group overflow-hidden" // no bg/ring/shadow
    : "group relative rounded-2xl bg-white/90 ring-1 ring-black/5 shadow-xl p-4 overflow-hidden";
  return (
    <div
      className={`${chrome} ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children(hovered)}

      {/* overlay text on hover */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-900/80 px-6 text-center text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <p className="text-sm leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
/* ===================== 1) Email outreach (inbox → email) ===================== */
function StarIcon({ className = "", size = 14 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden className={className}>
      <path d="M10 1.5l2.7 5.48 6.05.88-4.38 4.27 1.03 6.02L10 15.85 4.6 18.15l1.03-6.02L1.25 7.86l6.05-.88L10 1.5z" fill="currentColor"/>
    </svg>
  );
}
function Stars5({ size = 14, className = "text-amber-500" }: { size?: number; className?: string }) {
  return (
    <div className="flex items-center gap-0.5" aria-label="5 out of 5 stars">
      {Array.from({ length: 5 }).map((_, i) => <StarIcon key={i} size={size} className={className} />)}
    </div>
  );
}

function EmailOutreachTile() {
  type Mode = "inbox" | "email";
  const [mode, setMode] = useState<Mode>("inbox");
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const upreviewRowRef = useRef<HTMLDivElement | null>(null);
  const happyBtnRef = useRef<HTMLButtonElement | null>(null);
  const timers = useRef<number[]>([]);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });

  const moveCursorTo = (el: HTMLElement | null, delay = 0) => {
    if (!el || !containerRef.current) return;
    const parent = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - parent.left + rect.width * 0.2; // left-ish
    const y = rect.top - parent.top + rect.height * 0.5;
    const t = window.setTimeout(() => setCursor({ x, y, visible: true }), delay);
    timers.current.push(t);
  };

  const run = () => {
    setMode("inbox");
    setCursor((c) => ({ ...c, visible: false }));

    let t = 0;
    // Move to the Upreview row
    t += 800; timers.current.push(window.setTimeout(() => moveCursorTo(upreviewRowRef.current), t));
    // "Click" → open email
    t += 500; timers.current.push(window.setTimeout(() => setMode("email"), t));
    // Move to Happy button
    t += 800; timers.current.push(window.setTimeout(() => moveCursorTo(happyBtnRef.current), t));
    // Hold on the button for a beat
    t += 1200;
    // Loop back to inbox to total ≈ 10s
    t += 700;  timers.current.push(window.setTimeout(() => { if (!hovered) run(); }, t));
  };

  useEffect(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    if (!hovered) {
      const kick = window.setTimeout(run, 300);
      timers.current.push(kick);
    }
    return () => { timers.current.forEach(window.clearTimeout); timers.current = []; };
  }, [hovered]);

  return (
    <HoverTile
      bare
      description="Send customisable emails to your clients to increase your review rate."
      className="rounded-2xl"
    >
      {(isHovered) => {
        if (hovered !== isHovered) setHovered(isHovered);
        return (
          <div ref={containerRef} className="relative h-[340px] rounded-2xl overflow-hidden">
            {/* light Gmail-like backdrop */}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-50 to-white" />

            {/* INBOX MODE */}
            {mode === "inbox" && (
              <div className="absolute inset-3 rounded-2xl bg-white ring-1 ring-black/5 shadow-2xl overflow-hidden">
                <div className="border-b bg-gray-50/80 px-4 py-2 text-xs text-gray-500">Inbox</div>
                <div className="divide-y">
                  {/* blurred generic rows */}
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className="h-8 w-8 rounded-full bg-gray-200" />
                      <div className="flex-1">
                        <div className="h-3 w-40 rounded bg-gray-200 mb-1" />
                        <div className="h-3 w-64 rounded bg-gray-100" />
                      </div>
                    </div>
                  ))}

                  {/* Upreview row — NOT blurred */}
                  <div
                    ref={upreviewRowRef}
                    className="flex items-center gap-3 px-4 py-3 bg-blue-50/40"
                  >
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">U</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900">Upreview</div>
                      <div className="truncate text-[12px] text-gray-700">We would love your feedback!</div>
                    </div>
                    <div className="ml-auto text-xs text-gray-500">12:17</div>
                  </div>

                  {/* more blurred rows */}
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={`b${i}`} className="flex items-center gap-3 px-4 py-3 opacity-50 blur-[1px]">
                      <div className="h-8 w-8 rounded-full bg-gray-200" />
                      <div className="flex-1">
                        <div className="h-3 w-48 rounded bg-gray-200 mb-1" />
                        <div className="h-3 w-56 rounded bg-gray-100" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* EMAIL MODE */}
            {mode === "email" && (
              <div className="absolute inset-3">
                <div className="h-full w-full overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(2,6,23,0.25)] ring-1 ring-black/5">
                  <div className="flex items-center gap-3 border-b bg-gray-50/80 px-4 py-2">
                    <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-[11px] font-bold text-white">U</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900">Upreview</div>
                      <div className="truncate text-[11px] text-gray-500">&lt;onboarding@upreview.app&gt;</div>
                    </div>
                    <div className="ml-auto text-gray-400">⋯</div>
                  </div>

                  <div className="border-b px-4 py-2">
                    <h4 className="m-0 truncate text-lg font-semibold text-gray-900">We would love your feedback!</h4>
                  </div>

                  <div className="px-4 py-4">
                    <p className="text-sm text-gray-800">
                      Hi <strong>Alex</strong>, thanks for choosing <strong>Upreview</strong>.
                      If you’re happy, please share a public review. If anything fell short, tell us privately so we can make it right.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        ref={happyBtnRef}
                        className="inline-flex items-center rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
                      >
                        Happy
                      </button>
                      <button className="inline-flex items-center rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white shadow hover:bg-rose-700">
                        Unsatisfied
                      </button>
                    </div>

                    <div className="mt-5 flex items-center gap-2 text-[12px] text-gray-500">
                      <Stars5 /> <span> Rated 5.0 on recent feedback</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Black cursor (always visible during sequence) */}
            <svg
              aria-hidden
              className="pointer-events-none absolute z-30 transition-transform duration-300"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              style={{
                transform: `translate(${cursor.x}px, ${cursor.y}px)`,
                opacity: cursor.visible ? 1 : 0,
              }}
            >
              <polygon points="0,0 0,12 8,8" fill="black" stroke="white" strokeWidth="0.5" />
            </svg>
          </div>
        );
      }}
    </HoverTile>
  );
}
/* ============ 2) AI review creation (centered + Google-style result) ============ */
function AiMakerTile() {
  const PHRASES = [
    "Friendly staff","Clear explanations","Quick turnaround","Easy booking","Great value",
    "Clean facility","Follow-up care","Highly recommend","Professional","Listened carefully",
    "No wait time","Went above and beyond","Parking was easy","Modern equipment","Excellent communication",
  ];
  const REVIEW =
    "I had an amazing experience with upreview — friendly staff, clear explanations, and a super quick turnaround. Leaving a review was effortless. Highly recommend upreview!";

  type Mode = "chips" | "generating" | "result";
  const [mode, setMode] = useState<Mode>("chips");
  const [hovered, setHovered] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number[]>([]);
  const clickOrder = useMemo(() => [0, 3, 5, 10, 12], []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const genBtnRef = useRef<HTMLButtonElement | null>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const setChipRef = (i: number) => (el: HTMLButtonElement | null): void => { chipRefs.current[i] = el; };
  const timers = useRef<number[]>([]);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });

  const moveCursorTo = (el: HTMLElement | null, delay = 0) => {
    if (!el || !containerRef.current) return;
    const parent = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - parent.left + rect.width / 2;
    const y = rect.top - parent.top + rect.height / 2;
    const t = window.setTimeout(() => setCursor({ x, y, visible: true }), delay);
    timers.current.push(t);
  };

  const run = () => {
    setMode("chips"); setSelectedIdx([]); setCursor((c) => ({ ...c, visible: false }));
    let t = 0;
    clickOrder.forEach((idx) => {
      t += 600; const target = chipRefs.current[idx];
      timers.current.push(window.setTimeout(() => moveCursorTo(target as HTMLElement), t));
      t += 220; timers.current.push(window.setTimeout(() => {
        setSelectedIdx((prev) => (prev.includes(idx) ? prev : [...prev, idx]));
      }, t));
    });
    t += 600; timers.current.push(window.setTimeout(() => moveCursorTo(genBtnRef.current), t));
    t += 300; timers.current.push(window.setTimeout(() => setMode("generating"), t));
    t += 1000; timers.current.push(window.setTimeout(() => setMode("result"), t));
    t += 2500; timers.current.push(window.setTimeout(() => { if (!hovered) run(); }, t));
  };

  useEffect(() => {
    timers.current.forEach(window.clearTimeout); timers.current = [];
    if (!hovered) {
      const kick = window.setTimeout(run, 300);
      timers.current.push(kick);
    }
    return () => { timers.current.forEach(window.clearTimeout); timers.current = []; };
  }, [hovered]);

  const chipEl = (label: string, i: number) => {
    const active = selectedIdx.includes(i);
    return (
      <button
        key={label}
        ref={setChipRef(i)}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition
          ${active ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-gray-300 bg-white text-gray-800"}`}
        type="button"
        aria-pressed={active}
      >
        {label} <span aria-hidden>{active ? "×" : "+"}</span>
      </button>
    );
  };

  return (
    <HoverTile
      bare
      description="Streamline the review process with personalised phrases and AI powered review creation, making it as easy as possible for your clients to leave you a good review."
      className="rounded-2xl"
    >
      {(isHovered) => {
        if (hovered !== isHovered) setHovered(isHovered);
        return (
          <div ref={containerRef} className="relative h-[340px] rounded-2xl bg-white ring-1 ring-black/5 shadow-2xl p-6">
            {mode === "chips" && (
              <div className="h-full w-full grid place-items-center">
                <div className="w-full">
                  <div className="flex flex-wrap justify-center gap-2">{PHRASES.map((p, i) => chipEl(p, i))}</div>
                  <div className="mt-6 flex justify-center">
                    <button
                      ref={genBtnRef}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Generate review
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mode === "generating" && (
              <div className="h-full w-full grid place-items-center">
                <div className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Generating…
                </div>
              </div>
            )}

            {mode === "result" && (
              <div className="h-full w-full grid place-items-center">
                {/* Google-style review card */}
                <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/5">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-600/90 text-white text-sm font-bold">A</div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900">Alex M.</div>
                      <div className="text-[11px] text-gray-500">Posted just now</div>
                    </div>
                    <div className="ml-auto"><Stars5 /></div>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-gray-800 text-center">
                    {REVIEW}
                  </p>
                  <div className="mt-3 flex items-center justify-center text-[11px] text-gray-500">Looks like a Google review</div>
                </div>
              </div>
            )}

            {/* cursor */}
            <svg
              aria-hidden
              className="pointer-events-none absolute z-30 transition-transform duration-300"
              width="16" height="16" viewBox="0 0 16 16"
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, opacity: cursor.visible ? 1 : 0 }}
            >
              <polygon points="0,0 0,12 8,8" fill="black" stroke="white" strokeWidth="0.5" />
            </svg>
          </div>
        );
      }}
    </HoverTile>
  );
}


/* ======== 3) Import clients (big button → zoom out → rows appear) ======== */
function ImportClientsTile() {
  type Mode = "button" | "table";
  const [mode, setMode] = useState<Mode>("button");
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const timers = useRef<number[]>([]);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });
  const [scale, setScale] = useState(1.08);
  const BASE_ROWS = [
    ["Alex Morgan", "alex@example.com", "0412 000 111", "12 Oct 2025", "PAID", "Review submitted"],
    ["Priya Nair", "priya@example.com", "0413 222 333", "02 Oct 2025", "PAID", "Review submitted"],
    ["Mark Li", "mark@example.com", "0414 444 555", "07 Nov 2025", "SENT", "Last email sent"],
    ["Sofia Rossi", "sofia@example.com", "0415 666 777", "03 Nov 2025", "DRAFT", "No email sent"],
    ["Diego Alvarez", "diego@example.com", "0416 888 999", "01 Nov 2025", "SENT", "Button clicked"],
  ] as const;
  const [rowsVisible, setRowsVisible] = useState(0);

  const moveCursorTo = (el: HTMLElement | null, delay = 0) => {
    if (!el || !containerRef.current) return;
    const parent = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - parent.left + rect.width / 2;
    const y = rect.top - parent.top + rect.height / 2;
    const t = window.setTimeout(() => setCursor({ x, y, visible: true }), delay);
    timers.current.push(t);
  };

  const run = () => {
    setMode("button"); setRowsVisible(0); setScale(1.08); setCursor((c) => ({ ...c, visible: false }));
    let t = 0;
    // Move to the big button & click
    t += 800; timers.current.push(window.setTimeout(() => moveCursorTo(buttonRef.current), t));
    t += 400; timers.current.push(window.setTimeout(() => setMode("table"), t));
    // Smooth zoom-out
    t += 100; timers.current.push(window.setTimeout(() => setScale(1.02), t));
    t += 300; timers.current.push(window.setTimeout(() => setScale(1.0), t));
    // Add rows one by one
    BASE_ROWS.forEach((_, i) => {
      t += 380; timers.current.push(window.setTimeout(() => setRowsVisible((v) => Math.min(v + 1, BASE_ROWS.length)), t));
    });
    // Pause, then loop
    t += 1200; timers.current.push(window.setTimeout(() => { if (!hovered) run(); }, t));
  };

  useEffect(() => {
    timers.current.forEach(window.clearTimeout); timers.current = [];
    if (!hovered) {
      const kick = window.setTimeout(run, 300);
      timers.current.push(kick);
    }
    return () => { timers.current.forEach(window.clearTimeout); timers.current = []; };
  }, [hovered]);

  return (
    <HoverTile
      bare
      description="Automatically import your clients from Xero, allowing for intelligent review emails to be sent"
      className="rounded-2xl"
    >
      {(isHovered) => {
        if (hovered !== isHovered) setHovered(isHovered);
        return (
          <div ref={containerRef} className="relative h-[340px] rounded-2xl overflow-hidden">
            {/* BUTTON MODE */}
            {mode === "button" && (
              <div className="absolute inset-0 grid place-items-center">
                <button
                  ref={buttonRef}
                  className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 px-6 py-4 text-white text-sm font-semibold shadow-2xl ring-1 ring-black/10"
                  aria-label="Import clients from Xero"
                >
                  Import clients from Xero
                </button>
              </div>
            )}

            {/* TABLE MODE (zooming container) */}
            {mode === "table" && (
              <div
                className="absolute inset-3 origin-center rounded-2xl bg-white ring-1 ring-black/5 shadow-2xl transition-transform duration-500"
                style={{ transform: `scale(${scale})` }}
              >
                <div className="grid grid-cols-6 gap-4 border-b px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  <div>Name</div><div>Email</div><div>Phone</div><div>Added</div>
                  <div className="text-center">Invoice Status</div>
                  <div className="text-center">Status</div>
                </div>
                <ul className="divide-y">
                  {BASE_ROWS.slice(0, rowsVisible).map((r, i) => (
                    <li key={i} className="grid grid-cols-6 gap-4 px-4 py-3 text-sm">
                      <div className="truncate font-medium text-gray-800">{r[0]}</div>
                      <div className="truncate text-gray-700">{r[1]}</div>
                      <div className="truncate text-gray-700">{r[2]}</div>
                      <div className="text-gray-700">{r[3]}</div>
                      <div className="justify-self-center self-center">
                        <span className="rounded-full bg-green-100 text-green-800 ring-1 ring-green-200 px-2 py-1 text-xs whitespace-nowrap">
                          {r[4]}
                        </span>
                      </div>
                      <div className="justify-self-center self-center">
                        <span className={`rounded-full ring-1 px-2 py-1 text-xs whitespace-nowrap ${
                          r[5].startsWith("Review") ? "bg-green-50 text-green-800 ring-green-200"
                          : r[5].startsWith("Last") ? "bg-blue-50 text-blue-800 ring-blue-200"
                          : r[5].startsWith("Button") ? "bg-amber-50 text-amber-800 ring-amber-200"
                          : "bg-gray-100 text-gray-700 ring-gray-200"
                        }`}>{r[5]}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* cursor */}
            <svg
              aria-hidden
              className="pointer-events-none absolute z-30 transition-transform duration-300"
              width="16" height="16" viewBox="0 0 16 16"
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, opacity: cursor.visible ? 1 : 0 }}
            >
              <polygon points="0,0 0,12 8,8" fill="black" stroke="white" strokeWidth="0.5" />
            </svg>
          </div>
        );
      }}
    </HoverTile>
  );
}


/* ======================================================================
   4) Review analytics (no chart; smaller colored stat card bottom-right;
      table itself is box; popup shifted so header row visible)
====================================================================== */
function AnalyticsTile() {
  return (
    <HoverTile
      bare
      description="Explore phrases, real excerpts, review trends over time, and quick stats like time to click."
      className="rounded-2xl"
    >
      {() => (
        <div className="relative h-[340px]">
          {/* phrases table (acts as box) */}
          <div className="absolute inset-3 rounded-2xl bg-white ring-1 ring-black/5 shadow-2xl overflow-hidden">
            <div className="grid grid-cols-12 gap-3 border-b px-4 py-3 text-left text-sm font-semibold text-gray-700">
              <div className="col-span-6">Phrase</div>
              <div className="col-span-3">Mentions</div>
              <div>Date</div>
              <div />
            </div>
            <ul className="divide-y">
              {[
                ["Friendly staff", "12", "26 Oct 2025"],
                ["Clear explanations", "8", "24 Oct 2025"],
                ["Long wait time", "5", "22 Oct 2025"],
                ["Parking was easy", "6", "01 Oct 2025"],
              ].map((r, i) => (
                <li key={i} className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm">
                  <div className="col-span-6 font-medium text-gray-900">{r[0]}</div>
                  <div className="col-span-3 text-gray-700">mentioned {r[1]} times</div>
                  <div className="text-gray-600">{r[2]}</div>
                  <div />
                </li>
              ))}
            </ul>
          </div>

          {/* focused excerpts popup — shifted down so header row “Phrase” stays visible */}
          <div className="absolute left-6 top-20 w-[340px] rounded-2xl border border-emerald-100 bg-emerald-50/85 p-3 text-xs text-emerald-900 shadow-2xl backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Friendly staff</span>
              <span className="rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 px-2 py-0.5">good</span>
            </div>
            <ul className="space-y-2">
              <li className="rounded-lg border border-emerald-100 bg-white/60 p-2">Everyone was so welcoming and friendly.</li>
              <li className="rounded-lg border border-emerald-100 bg-white/60 p-2">Staff went above and beyond to help.</li>
            </ul>
          </div>

          {/* small, colored time-to-click card — bottom-right */}
          <div className="absolute right-6 bottom-6 w-[200px] rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 p-4 text-left shadow-lg ring-1 ring-black/10">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-semibold text-white/95">Time to click</div>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-white/15 text-white ring-1 ring-white/20">
                demo
              </span>
            </div>
            <div className="text-xl font-semibold tracking-tight text-white">2m 35s</div>
            <div className="mt-0.5 text-[11px] text-white/90">Average delay to first click</div>
          </div>
        </div>
      )}
    </HoverTile>
  );
}

/* ---------- Exported grid ---------- */
export default function FeatureGrid() {
  return (
    <section className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <EmailOutreachTile />
        <AiMakerTile />
        <ImportClientsTile />
        <AnalyticsTile />
      </div>
    </section>
  );
}
