"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

/* ------------------------------ Stars ------------------------------ */
function StarIcon({ className = "", size = 16 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden className={className}>
      <path d="M10 1.5l2.7 5.48 6.05.88-4.38 4.27 1.03 6.02L10 15.85 4.6 18.15l1.03-6.02L1.25 7.86l6.05-.88L10 1.5z" fill="currentColor"/>
    </svg>
  );
}
function Stars5({ size = 16, className = "text-amber-500" }: { size?: number; className?: string }) {
  return (
    <div className="flex items-center gap-0.5" aria-label="5 out of 5 stars">
      {Array.from({ length: 5 }).map((_, i) => <StarIcon key={i} size={size} className={className} />)}
    </div>
  );
}

/* ---------------------------- Big cursor --------------------------- */
function Cursor({ x, y, visible }: { x: number; y: number; visible: boolean }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute z-50 transition-transform duration-300 drop-shadow"
      width="26" height="26" viewBox="0 0 26 26"
      style={{ transform: `translate(${x}px, ${y}px)`, opacity: visible ? 1 : 0 }}
    >
      <polygon points="0,0 0,20 14,14" fill="black" stroke="white" strokeWidth="1.25" />
    </svg>
  );
}

/* ------------------- Slide shell: tall & narrower ------------------ */
function SlideShell({ children, caption }: { children: React.ReactNode; caption: React.ReactNode }) {
  return (
    <div className="w-full">
      {/* tall & narrower */}
      <div className="relative mx-auto h-[600px] max-w-[980px]">
        {children}
      </div>
      <div className="mt-6 text-lg md:text-xl leading-7 text-center text-slate-700/90 font-medium tracking-tight">{caption}</div>
    </div>
  );
}

/* ----------------- StrictMode-safe timer sequencing ---------------- */
function useSequencer() {
  const timers = useRef<number[]>([]);
  const seq = useRef(0);
  const clearAll = () => { timers.current.forEach(window.clearTimeout); timers.current = []; };
  const begin = () => { clearAll(); seq.current += 1; return seq.current; };
  const schedule = (runSeq: number, fn: () => void, delay: number) => {
    const id = window.setTimeout(() => { if (seq.current === runSeq) fn(); }, delay);
    timers.current.push(id);
    return id;
  };
  useEffect(() => clearAll, []);
  return { begin, schedule, clearAll, seq };
}
/* =========================== Slide 1: Email (stable) =========================== */
function EmailOutreachSlide({ active }: { active: boolean }) {
  type Mode = "inbox" | "email";
  const [mode, setMode] = useState<Mode>("inbox");
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const upreviewRowRef = useRef<HTMLDivElement | null>(null);
  const happyBtnRef = useRef<HTMLButtonElement | null>(null);
  const [cursor, setCursor] = useState({ x: 8, y: 8, visible: false });

  const { begin, schedule, clearAll } = useSequencer();

  const BLURRED_ROWS = [
    { from: "The New York Times", subject: "Breaking news: city updates", time: "1:47 PM" },
    { from: "Google Security", subject: "New sign-in to your account", time: "Nov 4" },
    { from: "UniSuper", subject: "2024-25 Members’ Meeting", time: "3:32 PM" },
    { from: "Indeed", subject: "Site Reliability Engineer", time: "1:45 AM" },
    { from: "Andrew Ross Sorkin", subject: "DealBook: Today’s brief", time: "12:17 AM" },
    { from: "The Morning", subject: "At the gun range", time: "Nov 4" },
    { from: "Payroll", subject: "2025 Pay Date", time: "Nov 4" },
    { from: "Google Business Pro.", subject: "A new review on your profile", time: "8:02 AM" },
    { from: "Climate brief", subject: "N.Y.C.’s big decisions", time: "5:30 AM" },
    { from: "Receipts", subject: "Your invoice is ready", time: "4:22 PM" },
  ];
  // Shorter inbox: remove one from top and one from bottom
  const topRows = BLURRED_ROWS.slice(1, 5);
  const bottomRows = BLURRED_ROWS.slice(-5, -1);

  // Safer measurement after layout settles
  const measureThen = (fn: () => void) => {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  };

  const moveCursorTo = (el: HTMLElement | null, runSeq: number, offsetX = 0.18, offsetY = 0.55) => {
    if (!el || !containerRef.current) return;
    const parent = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - parent.left + rect.width * offsetX;
    const y = rect.top - parent.top + rect.height * offsetY;
    schedule(runSeq, () => setCursor({ x, y, visible: true }), 0);
  };

  const run = () => {
    const runSeq = begin();
    setMode("inbox");
    setCursor((c) => ({ ...c, visible: false }));

    let t = 0;

    // 1) Let the inbox paint, then move to the Upreview row (center of list)
    t += 900;
    schedule(runSeq, () => {
      measureThen(() => moveCursorTo(upreviewRowRef.current, runSeq, 0.18, 0.52));
    }, t);

    // 2) Open the email
    t += 500;
    schedule(runSeq, () => setMode("email"), t);

    // 3) After the email DOM is rendered, measure again and move to the Happy button
    t += 120; // tiny buffer so the new layout stabilizes
    schedule(runSeq, () => {
      measureThen(() => moveCursorTo(happyBtnRef.current, runSeq, 0.20, 0.55));
    }, t);

    // 4) Hold on the button
    t += 1600;

    // 5) Loop while visible & not hovered
    t += 1200;
    schedule(runSeq, () => { if (!hovered && active) run(); }, t);
  };

  // Stable deps to avoid the "final argument size changed" error
  const deps = [active, hovered] as const;
  useEffect(() => {
    clearAll();
    if (deps[0] && !deps[1]) {
      const kick = begin();
      schedule(kick, run, 300);
    }
    return clearAll;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className="relative h-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* INBOX */}
      {mode === "inbox" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[92%] max-w-[860px] overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 shadow-2xl">
            <div className="border-b bg-gray-50/80 px-4 py-2 text-xs text-gray-500">Inbox</div>
            <div className="divide-y">
              {/* Group top rows in a single blurred container (smoother/GPU-friendly) */}
              <div className="filter blur-[2px] opacity-70 pointer-events-none">
                {topRows.map((r, i) => (
                  <div key={`t${i}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-5 w-5 rounded-sm border" />
                    <div className="h-5 w-5 rounded-full border" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900">{r.from}</div>
                      <div className="truncate text-[12px] text-gray-700">{r.subject}</div>
                    </div>
                    <div className="ml-auto text-xs text-gray-500">{r.time}</div>
                  </div>
                ))}
              </div>

              {/* Upreview focused row (center) */}
              <div ref={upreviewRowRef} className="flex items-center gap-3 px-4 py-3 bg-blue-50/60">
                <div className="h-5 w-5 rounded-sm border border-blue-200 bg-white" />
                <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">U</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-gray-900">UpReview</div>
                  <div className="truncate text-[12px] text-gray-700">We would love your feedback!</div>
                </div>
                <div className="ml-auto text-xs text-gray-500">12:17</div>
              </div>

              {/* Group bottom rows in one blurred container, too */}
              <div className="filter blur-[2px] opacity-70 pointer-events-none">
                {bottomRows.map((r, i) => (
                  <div key={`b${i}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-5 w-5 rounded-sm border" />
                    <div className="h-5 w-5 rounded-full border" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900">{r.from}</div>
                      <div className="truncate text-[12px] text-gray-700">{r.subject}</div>
                    </div>
                    <div className="ml-auto text-xs text-gray-500">{r.time}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EMAIL */}
      {mode === "email" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[92%] max-w-[860px] overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(2,6,23,0.25)] ring-1 ring-black/5">
            <div className="flex items-center gap-3 border-b bg-gray-50/80 px-4 py-2">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-[11px] font-bold text-white">U</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-900">UpReview</div>
                <div className="truncate text-[11px] text-gray-500">&lt;onboarding@upreview.app&gt;</div>
              </div>
              <div className="ml-auto text-gray-400">⋯</div>
            </div>

            <div className="border-b px-4 py-3">
              <h4 className="m-0 truncate text-xl font-semibold text-gray-900">We would love your feedback!</h4>
            </div>

            <div className="px-6 py-6 space-y-4">
              <p className="text-[15px] leading-relaxed text-gray-800">
                Hi <strong>Alex</strong>, thanks again for choosing <strong>UpReview</strong>. Your experience matters to us —
                it helps us keep improving and also helps others choose with confidence.
              </p>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 text-[14px] leading-relaxed text-slate-800">
                <p className="font-medium mb-2">Tell us how it went:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Was booking and communication smooth?</li>
                  <li>Did our team meet your expectations?</li>
                  <li>Anything we could improve next time?</li>
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  ref={happyBtnRef}
                  className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-700"
                >
                  Happy — leave a positive review
                </button>
                <button className="inline-flex items-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-rose-700">
                  Unsatisfied — tell us what went wrong
                </button>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <Stars5 /> <span> Rated 5.0 on recent feedback</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <Cursor x={cursor.x} y={cursor.y} visible={cursor.visible} />
    </div>
  );
}


/* ======================= Slide 2: AI review maker ======================= */
function BoldPhraseList({ phrases }: { phrases: string[] }) {
  return (
    <>
      {phrases.map((p, i) => (
        <span key={p}>
          <strong>{p}</strong>
          {i < phrases.length - 2 ? ", " : i === phrases.length - 2 ? " and " : ""}
        </span>
      ))}
    </>
  );
}

function AiMakerSlide({ active }: { active: boolean }) {
  const PHRASES = [
    "Friendly staff","Clear explanations","Quick turnaround","Easy booking","Great value",
    "Clean facility","Follow-up care","Highly recommend","Professional","Listened carefully",
    "No wait time","Went above and beyond","Parking was easy","Modern equipment","Excellent communication",
  ];

  type Mode = "chips" | "generating" | "result";
  const [mode, setMode] = useState<Mode>("chips");
  const [hovered, setHovered] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number[]>([]);
  const clickOrder = useMemo(() => [0, 3, 5, 10, 12, 2, 8], []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const genBtnRef = useRef<HTMLButtonElement | null>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [cursor, setCursor] = useState({ x: 12, y: 12, visible: true });

  const { begin, schedule, clearAll } = useSequencer();

  const setChipRef = (i: number) => (el: HTMLButtonElement | null): void => { chipRefs.current[i] = el; };

  const moveCursorTo = (el: HTMLElement | null, delay = 0, runSeq?: number) => {
    if (!el || !containerRef.current || runSeq == null) return;
    const parentRect = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - parentRect.left + rect.width / 2;
    const y = rect.top - parentRect.top + rect.height / 2;
    schedule(runSeq, () => setCursor({ x, y, visible: true }), delay);
  };

  const run = () => {
    const runSeq = begin();
    setMode("chips");
    setSelectedIdx([]);
    setCursor((c) => ({ ...c, visible: true }));

    let t = 400;
    clickOrder.forEach((idx) => {
      const target = chipRefs.current[idx];
      t += 720;  moveCursorTo(target as HTMLElement, t, runSeq);
      t += 280;  schedule(runSeq, () => {
        setSelectedIdx((prev) => (prev.includes(idx) ? prev : [...prev, idx]));
      }, t);
    });
    t += 820;  moveCursorTo(genBtnRef.current, t, runSeq);
    t += 420;  schedule(runSeq, () => setMode("generating"), t);
    t += 1200; schedule(runSeq, () => setMode("result"), t);
    t += 4800; schedule(runSeq, () => { if (!hovered && active) run(); }, t);
  };

  const deps = [active, hovered] as const;
  useEffect(() => {
    clearAll();
    if (deps[0] && !deps[1]) {
      const kickSeq = begin();
      schedule(kickSeq, run, 300);
    }
    return clearAll;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const pickedPhrases = useMemo(() => selectedIdx.map((i) => PHRASES[i]), [selectedIdx]);

  return (
    <div
      ref={containerRef}
      className="relative h-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {mode === "chips" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="w-full max-w-[720px]">
            <div className="flex flex-wrap justify-center gap-2 max-h-[420px] overflow-hidden px-4">
              {PHRASES.map((p, i) => (
                <button
                  key={p}
                  ref={setChipRef(i)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm md:text-base font-semibold transition
                    ${selectedIdx.includes(i) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-gray-300 bg-white text-gray-800"}`}
                  type="button"
                  aria-pressed={selectedIdx.includes(i)}
                >
                  {p} <span aria-hidden>{selectedIdx.includes(i) ? "×" : "+"}</span>
                </button>
              ))}
            </div>
            <div className="mt-8 flex justify-center">
              <button ref={genBtnRef} className="rounded-xl bg-blue-600 px-6 py-3 text-base md:text-lg font-semibold text-white shadow-lg hover:bg-blue-700">
                Generate review
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "generating" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Generating…
          </div>
        </div>
      )}

      {mode === "result" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-blue-600/90 text-white text-sm font-bold">A</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">Alex M.</div>
                <div className="text-[11px] text-gray-500">Posted just now</div>
              </div>
              <div className="ml-auto"><Stars5 size={18} /></div>
            </div>
                <p className="mt-4 text-[15px] leading-relaxed text-gray-800 text-center">
                I had an amazing experience with UpReview. The <strong>Friendly Staff</strong> made everything feel
                welcoming, <strong>Easy Booking</strong> meant scheduling was simple, and the
                <strong> Clean Facility</strong> really stood out. There was <strong>No wait time</strong>,{" "}
                <strong>Parking was easy</strong>, and the <strong>Quick turnaround</strong> showed how{" "}
                <strong>Professional</strong> the whole service is. Leaving a review was effortless and I&apos;d
                happily recommend UpReview to others.
                </p>
            <div className="mt-3 flex items-center justify-center text-[11px] text-gray-500">Looks like a Google review</div>
          </div>
        </div>
      )}

      <Cursor x={cursor.x} y={cursor.y} visible={cursor.visible} />
    </div>
  );
}

/* ========================= Slide 3: Import clients ========================= */
function ImportClientsSlide({ active }: { active: boolean }) {
  type Mode = "button" | "table";
  const [mode, setMode] = useState<Mode>("button");
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [cursor, setCursor] = useState({ x: 12, y: 12, visible: true });
  const [docked, setDocked] = useState(false);
  const { begin, schedule, clearAll } = useSequencer();

  const BASE_ROWS = [
    ["Alex Morgan", "alex@example.com", "0412 000 111", "12 Oct 2025", "PAID", "Review submitted"],
    ["Priya Nair", "priya@example.com", "0413 222 333", "02 Oct 2025", "PAID", "Review submitted"],
    ["Mark Li", "mark@example.com", "0414 444 555", "07 Nov 2025", "SENT", "Last email sent"],
    ["Sofia Rossi", "sofia@example.com", "0415 666 777", "03 Nov 2025", "DRAFT", "No email sent"],
    ["Diego Alvarez", "diego@example.com", "0416 888 999", "01 Nov 2025", "SENT", "Button clicked"],
    ["Hannah Lee", "hannah@example.com", "0417 333 444", "30 Oct 2025", "PAID", "Review submitted"],
    ["James O’Connor", "james@example.com", "0418 555 666", "29 Oct 2025", "SENT", "Last email sent"],
    ["Amara Singh", "amara@example.com", "0402 777 888", "28 Oct 2025", "DRAFT", "No email sent"],
    ["Luca Bianchi", "luca@example.com", "0403 999 000", "27 Oct 2025", "PAID", "Review submitted"],
    ["Maya Chen", "maya@example.com", "0404 111 222", "26 Oct 2025", "SENT", "Button clicked"],
    ["Oliver Wright", "oliver@example.com", "0405 333 222", "25 Oct 2025", "PAID", "Review submitted"],
    ["Zara Patel", "zara@example.com", "0406 444 333", "24 Oct 2025", "SENT", "Last email sent"],
  ] as const;

  const [rowsVisible, setRowsVisible] = useState(0);

  const moveCursorTo = (el: HTMLElement | null, delay = 0, runSeq?: number) => {
    if (!el || !containerRef.current || runSeq == null) return;
    const parentRect = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - parentRect.left + rect.width / 2;
    const y = rect.top - parentRect.top + rect.height / 2;
    schedule(runSeq, () => setCursor({ x, y, visible: true }), delay);
  };

  const run = () => {
    const runSeq = begin();
    setMode("button"); setRowsVisible(0); setDocked(false); setCursor((c) => ({ ...c, visible: true }));
    let t = 0;
    t += 900;  moveCursorTo(buttonRef.current, t, runSeq);
    t += 500;  schedule(runSeq, () => setMode("table"), t);
    t += 50;   schedule(runSeq, () => setDocked(true), t); // dock to top-right (y-above table)
    BASE_ROWS.forEach(() => {
      t += 420; schedule(runSeq, () => setRowsVisible((v) => Math.min(v + 1, BASE_ROWS.length)), t);
    });
    t += 1600; schedule(runSeq, () => { if (!hovered && active) run(); }, t);
  };

  const deps = [active, hovered] as const;
  useEffect(() => {
    clearAll();
    if (deps[0] && !deps[1]) {
      const kickSeq = begin();
      schedule(kickSeq, run, 300);
    }
    return clearAll;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className="relative h-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Table is lower/shorter so the docked button sits above on the y-axis */}
      {mode === "table" && (
        <div className="absolute left-3 right-3 bottom-3 top-[96px]">
          <div className="h-full w-full overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 shadow-2xl">
            <div className="grid grid-cols-6 gap-4 border-b px-4 py-3 text-left text-sm font-semibold text-gray-700">
              <div>Name</div><div>Email</div><div>Phone</div><div>Added</div>
              <div className="text-center">Invoice Status</div>
              <div className="text-center">Status</div>
            </div>
            <ul className="divide-y overflow-auto">
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
        </div>
      )}

      {/* Docking CTA */}
      <button
        ref={buttonRef}
        className={[
          "absolute z-20 select-none rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 px-6 py-4",
          "text-white text-sm font-semibold shadow-2xl ring-1 ring-black/10 transition-all duration-700",
          docked ? "right-6 top-6 translate-x-0 translate-y-0 scale-90" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-100",
        ].join(" ")}
        aria-label="Import clients from Xero"
      >
        Import clients from Xero
      </button>

      <Cursor x={cursor.x} y={cursor.y} visible={cursor.visible} />
    </div>
  );
}
/* =========================== Slide 4: Common Excerpts =========================== */
function PhrasesExcerptsSlide({ active }: { active: boolean }) {
  type Mode = "button" | "table" | "excerpts";
  const [mode, setMode] = useState<Mode>("button");
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [cursor, setCursor] = useState({ x: 8, y: 8, visible: false });
  const [buttonDocked, setButtonDocked] = useState(false); // slides to top-right
  const [hoverRowKey, setHoverRowKey] = useState<string | null>(null); // highlight when cursor moves over a row

  const { begin, schedule, clearAll } = useSequencer();

  // Safe measurement after layout
  const measureThen = (fn: () => void) => {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  };

  const moveCursorTo = (
    el: HTMLElement | null,
    runSeq: number,
    opts?: { ox?: number; oy?: number }
  ) => {
    if (!el || !containerRef.current) return;
    const parent = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - parent.left + rect.width * (opts?.ox ?? 0.5);
    const y = rect.top - parent.top + rect.height * (opts?.oy ?? 0.5);
    schedule(runSeq, () => setCursor({ x, y, visible: true }), 0);
  };

  const run = () => {
    const runSeq = begin();

    // Reset state
    setMode("button");
    setButtonDocked(false);
    setCursor((c) => ({ ...c, visible: false }));
    setHoverRowKey(null);

    let t = 0;

    // Move to center button
    t += 700;
    schedule(runSeq, () => {
      measureThen(() => moveCursorTo(buttonRef.current, runSeq));
    }, t);

    // Click: show table, slide & shrink button to top-right
    t += 500;
    schedule(runSeq, () => {
      setMode("table");
      setButtonDocked(true);
    }, t);

    // After table renders, move to the "Friendly staff" row (+ transient highlight)
    t += 500;
    schedule(runSeq, () => {
      setHoverRowKey("friendly");
      measureThen(() => moveCursorTo(rowRefs.current["friendly"], runSeq, { ox: 0.15, oy: 0.55 }));
    }, t);

    // Let the highlight linger briefly before clicking
    t += 300;
    schedule(runSeq, () => setHoverRowKey(null), t);

    // Click the row → show excerpts
    t += 300;
    schedule(runSeq, () => setMode("excerpts"), t);

    // Hold on excerpts LONGER so all 10 can be read
    t += 5200;

    // Loop while active and not hovered
    t += 800;
    schedule(runSeq, () => {
      if (!hovered && active) run();
    }, t);
  };

  // Stable deps
  const deps = [active, hovered] as const;
  useEffect(() => {
    clearAll();
    if (deps[0] && !deps[1]) {
      const kick = begin();
      schedule(kick, run, 300);
    }
    return clearAll;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Table data (10 phrases) ----------
  const PHRASES: Array<{ phrase: string; mentions: number; date: string; key: string }> = [
    { phrase: "Friendly staff",         mentions: 12, date: "26 Oct 2025", key: "friendly" },
    { phrase: "Clear explanations",     mentions:  8, date: "24 Oct 2025", key: "clear" },
    { phrase: "Long wait time",         mentions:  5, date: "22 Oct 2025", key: "wait" },
    { phrase: "Parking was easy",       mentions:  6, date: "01 Oct 2025", key: "parking" },
    { phrase: "Modern equipment",       mentions:  4, date: "28 Sep 2025", key: "modern" },
    { phrase: "Follow-up care",         mentions:  7, date: "19 Oct 2025", key: "followup" },
    { phrase: "Clean facility",         mentions:  9, date: "14 Oct 2025", key: "clean" },
    { phrase: "Professional",           mentions: 11, date: "09 Oct 2025", key: "professional" },
    { phrase: "No wait time",           mentions:  6, date: "03 Oct 2025", key: "no_wait" },
  ];

  // Row refs (by key) for precise cursor placement
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setRowRef = (key: string) => (el: HTMLDivElement | null) => {
    rowRefs.current[key] = el;
  };

  // 10 excerpts for "Friendly staff" (all shown)
  const FRIENDLY_EXCERPTS = [
    "Everyone was so welcoming and friendly.",
    "Staff went above and beyond to help.",
    "The team were kind and attentive throughout.",
    "Front desk greeted me with a smile.",
    "Really personable and easy to talk to.",
    "Felt supported from check-in to follow-up.",
    "Nurses were warm and professional.",
    "Genuine care from all staff members.",
    "They made me feel comfortable immediately.",
    "Exceptional service — friendly from start to finish.",
  ];

  return (
    <div
      ref={containerRef}
      className="relative h-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Center button that docks to top-right */}
      <div className="absolute inset-0">
        <button
          ref={buttonRef}
          className={[
            "absolute z-20 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white text-sm font-semibold shadow-2xl ring-1 ring-black/10",
            "transition-[top,left,right,bottom,transform,padding] duration-700 ease-out",
            buttonDocked
              ? "top-3 right-4 left-auto bottom-auto px-4 py-2"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-4",
          ].join(" ")}
          aria-label="Find common excerpts from reviews"
        >
          Find common excerpts from reviews
        </button>
      </div>

      {/* PHRASES TABLE (shows in 'table' or 'excerpts' modes) */}
      {(mode === "table" || mode === "excerpts") && (
        <div className="absolute inset-x-3 bottom-3 top-16 rounded-2xl bg-white ring-1 ring-black/5 shadow-2xl">
          <div className="grid grid-cols-12 gap-3 border-b px-4 py-3 text-left text-sm font-semibold text-gray-700">
            <div className="col-span-6">Phrase</div>
            <div className="col-span-3">Mentions</div>
            <div className="col-span-2">Last seen</div>
            <div />
          </div>

          <ul className="divide-y">
            {PHRASES.map((r) => {
              const selected = r.key === "friendly" && mode === "excerpts";
              const highlight = hoverRowKey === r.key;

              return (
                <li key={r.key}>
                  <div
                    ref={setRowRef(r.key)}
                    className={[
                      "grid grid-cols-12 items-center gap-3 px-4",
                      // Taller rows
                      "py-3.5 md:py-4",
                      // Slightly larger text on md+
                      "text-sm md:text-[15px]",
                      "transition-colors cursor-pointer",
                      selected
                        ? "bg-emerald-50/80"
                        : highlight
                          ? "bg-emerald-50/40"
                          : "bg-white hover:bg-emerald-50/30",
                    ].join(" ")}
                  >
                    <div className="col-span-6 font-medium text-gray-900">{r.phrase}</div>
                    <div className="col-span-3 text-gray-700">mentioned {r.mentions} times</div>
                    <div className="col-span-2 text-gray-600">{r.date}</div>
                    <div />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* EXCERPTS DROPDOWN (big enough to show all 10) */}
      {mode === "excerpts" && (
        <div
          className="absolute left-6 top-24 z-30 w-[440px] rounded-2xl border border-emerald-100 bg-emerald-50/90 p-3 text-xs text-emerald-900 shadow-2xl backdrop-blur"
          style={{ maxHeight: "none" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Friendly staff</span>
            <span className="rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 px-2 py-0.5">
              10 excerpts
            </span>
          </div>
          <ul className="space-y-2">
            {FRIENDLY_EXCERPTS.map((ex, i) => (
              <li
                key={i}
                className="rounded-lg border border-emerald-100 bg-white/70 p-2 leading-relaxed"
              >
                {ex}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Cursor x={cursor.x} y={cursor.y} visible={cursor.visible} />
    </div>
  );
}


/* ============================== Carousel ============================== */
type SlideDef = { key: string; render: (active: boolean) => ReactElement; caption: string; };

export default function FeatureCarousel() {
  const slides: SlideDef[] = [
    { key: "email",     render: (active) => <EmailOutreachSlide active={active} />,  caption: "Send customisable emails to your clients to increase your review rate." },
    { key: "aimaker",   render: (active) => <AiMakerSlide active={active} />,        caption: "Personalise phrases and generate polished, 5-star reviews with one click." },
    { key: "import",    render: (active) => <ImportClientsSlide active={active} />,  caption: "Import clients from Xero and watch your table fill up — synced and ready." },
    { key: "phrases",   render: (active) => <PhrasesExcerptsSlide active={active} />,  caption: "Find common excerpts from reviews, then drill into linked snippets." },
  ];

  const [index, setIndex] = useState(0);

  // No auto-advance — manual only
  return (
    <section className="relative space-y-10">
      {/* Active slide is keyed to guarantee full remount on change */}
      <SlideShell caption={slides[index].caption}>
        <div key={slides[index].key} className="absolute inset-0">
          {slides[index].render(true)}
        </div>
      </SlideShell>

      {/* Progress bars (sea colours) */}
      <div className="flex items-center justify-center gap-3">
        {slides.map((s, i) => (
          <button
            key={s.key}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => setIndex(i)}
            className={`h-1.5 w-16 rounded-full transition ${i === index ? "bg-sky-500" : "bg-sky-200 hover:bg-sky-300"}`}
          />
        ))}
      </div>

      {/* Outside arrows — brighter sea colour */}
      <button
        aria-label="Previous"
        onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
        className="absolute left-[-110px] top-[300px] -translate-y-1/2 select-none text-7xl font-semibold leading-none text-sky-600 hover:text-sky-700"
      >
        ‹
      </button>
      <button
        aria-label="Next"
        onClick={() => setIndex((i) => (i + 1) % slides.length)}
        className="absolute right-[-110px] top-[300px] -translate-y-1/2 select-none text-7xl font-semibold leading-none text-sky-600 hover:text-sky-700"
      >
        ›
      </button>
    </section>
  );
}
