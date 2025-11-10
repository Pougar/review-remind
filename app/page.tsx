"use client";

import Link from "next/link";
import { useMemo, useState, useCallback, useEffect } from "react";
import { ROUTES } from "@/app/lib/constants";
import FeatureCarousel from "@/app/ui/landing/FeatureCarousel";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Area,
  Line,
} from "recharts";

/* ------------------------------------------------------------------
   Landing Page (Demo-only, no API calls)
   - Shows: Clients list, Email preview (with review pop-up),
            Phrases & Excerpts analytics demo
   - Everything uses dummy data and local state only.
------------------------------------------------------------------- */

/* ======================== DATE/LOCALE UTILITIES ======================== */
const DATE_LOCALE = "en-AU" as const;
const DATE_TZ = "Australia/Sydney" as const;

const _fmtDateOnly = new Intl.DateTimeFormat(DATE_LOCALE, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  timeZone: DATE_TZ,
});

const _fmtDateTime = new Intl.DateTimeFormat(DATE_LOCALE, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: DATE_TZ,
});

function formatDateOnly(iso?: string | null) {
  return iso ? _fmtDateOnly.format(new Date(iso)) : "—";
}
function formatDateTime(iso?: string | null) {
  return iso ? _fmtDateTime.format(new Date(iso)) : "—";
}
// NEW: Fixed top nav
// NEW: Fixed top nav (full-height buttons, left-aligned, offset-aware scroll)
function TopNavFixed() {
  const items = [
    { id: "hero", label: "Home" },
    { id: "analytics", label: "Analytics" },
    { id: "features", label: "Features" },
  ];

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const header = document.querySelector('header[data-landing-nav]') as HTMLElement | null;
    const offset = (header?.offsetHeight ?? 64) + 8;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <header
      data-landing-nav
      className="fixed inset-x-0 top-0 z-50 border-b border-zinc-200 bg-zinc-50 shadow-sm"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-stretch px-6">
        {/* Left group: brand + nav */}
        <div className="flex items-stretch">
          <Link
            href="/"
            className="flex h-full items-center px-1 text-base font-extrabold tracking-tight text-slate-900"
            aria-label="Upreview — Home"
          >
            UpReview
          </Link>

          {/* Divider between brand and links */}
          <span
            aria-hidden="true"
            className="hidden sm:block mx-3 w-px self-stretch bg-gray-200"
          />

          <nav className="hidden sm:flex items-stretch">
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => go(i.id)}
                className="h-full inline-flex items-center px-4 text-base font-semibold text-gray-700 hover:bg-gray-200 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                {i.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: CTA (square corners) */}
        <Link
          href={ROUTES.SIGN_UP}
          aria-label="Sign up"
          className="ml-auto inline-flex items-center px-6 py-2.5 text-base font-semibold text-white shadow-md shadow-blue-600/20
                     bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-95 active:scale-[0.98] transition"
        >
          Try now
        </Link>
      </div>
    </header>
  );
}


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

/* ======================== NEW: Top hero ======================== */
// Replace your Star + Stars5 with this:

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

function GmailLikeEmail({ className = "" }: { className?: string }) {
  return (
    <div className={`relative w-full max-w-[560px] ${className}`}>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(2,6,23,0.25)] ring-1 ring-black/5">
        {/* Gmail-ish header */}
        <div className="flex items-center gap-3 border-b bg-gray-50/80 px-4 py-2">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-[11px] font-bold text-white">
            U
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-900">UpReview</div>
            <div className="truncate text-[11px] text-gray-500">
              &lt;onboarding@upreview.app&gt;
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 text-gray-400">
            <span aria-hidden>⤓</span>
            <span aria-hidden>⋯</span>
          </div>
        </div>
        {/* Subject row */}
        <div className="border-b px-4 py-2">
          <h4 className="m-0 truncate text-lg font-semibold text-gray-900">
            We’d love your feedback
          </h4>
        </div>
        {/* Body */}
        <div className="px-4 py-4">
          <p className="text-sm text-gray-800">
            Hi <strong>Alex</strong>, thanks for choosing <strong>UpReview</strong>. If you’re
            happy, please share a public review. If anything fell short, tell us so we can
            make it right.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="inline-flex items-center rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 focus:outline-none">
              Happy
            </button>
            <button className="inline-flex items-center rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white shadow hover:bg-rose-700 focus:outline-none">
              Unsatisfied
            </button>
          </div>
        </div>
      </div>

      {/* Layered review cards */}
      <ReviewMiniCard
        className="absolute -right-8 -bottom-8 rotate-3"
        author="Priya N."
        text="So easy to book and the team was lovely."
      />
      <ReviewMiniCard
        className="absolute -left-10 -top-6 -rotate-3"
        author="Mark L."
        text="Five stars! Clear explanations and quick turnaround."
      />
    </div>
  );
}

function HeroSection() {
  return (
    <section id="hero" className="relative">
      {/* two-column layout matching your screenshot */}
      <div className="grid items-center gap-10 md:grid-cols-2">
        {/* Left: big bold copy */}
        <div className="max-w-xl">
          <div className="h-1.5 w-20 rounded-full bg-amber-400/80 mb-6" />
          <h1 className="text-4xl md:text-6xl font-extrabold leading-[1.05] tracking-tight text-slate-900">
            Make your business stand out
            <br className="hidden md:block" />
            and <span className="text-slate-900">up your 
              <br className="hidden md:block" />
              review count 
              <br className="hidden md:block" />
              with us.</span>
            <br className="hidden md:block" />
          </h1>
          <p className="mt-6 max-w-md text-base md:text-lg text-slate-600">
            It’s better to stand out from the bunch. Our simple yet powerful software helps you earn
            more 5-star reviews, capture feedback in real time, and build a celebrated reputation.
          </p>
          <div className="mt-8">
            <Link
          href={ROUTES.SIGN_UP}
          aria-label="Sign up"
          className="inline-flex items-center rounded-xl px-6 py-2.5 text-base font-semibold text-white shadow-md shadow-blue-600/20
                     bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-95 active:scale-[0.98] transition"
        >
          Try now
        </Link>
          </div>
        </div>

        {/* Right: Gmail-style email with layered review cards */}
        <div className="relative flex items-center justify-center md:justify-end">
          <GmailLikeEmail className="translate-x-6 sm:translate-x-10 lg:translate-x-16"/>
        </div>
      </div>
    </section>
  );
}
/* ======================== UTIL: short duration formatter ======================== */
function formatDurationShort(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/* ======================== Mini check icon ======================== */
function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} width={18} height={18}>
      <path
        fill="currentColor"
        d="M8.3 13.3L4.7 9.7l1.4-1.4 2.2 2.2L14 4.8l1.4 1.4-7.1 7.1z"
      />
    </svg>
  );
}
/* ======================== Analytics KPI card (avg time to click) ======================== */
function TimeToClickCard({
  title,
  seconds,
  loading = false,
  badgeText,
}: {
  title: string;
  seconds: number | null;
  loading?: boolean;
  badgeText?: string;
}) {
  const formatted = useMemo(() => formatDurationShort(seconds), [seconds]);

  return (
    <div
      className={[
        "w-[260px] rounded-2xl p-4 text-left",
        // glassy background
        "bg-white/25 backdrop-blur-md",
        // very subtle outline & shadow so it reads on light gradients
        "ring-1 ring-white/40 shadow-[0_20px_40px_-20px_rgba(2,6,23,0.30)]",
      ].join(" ")}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900/90">{title}</div>
        {badgeText && (
          <span className="rounded-full px-2 py-1 text-[11px] font-medium bg-white/30 backdrop-blur-md ring-1 ring-white/50 text-slate-800/90">
            {badgeText}
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-6 w-32 animate-pulse rounded bg-white/50" />
      ) : (
        <div className="text-2xl font-semibold tracking-tight text-slate-900">
          {formatted}
        </div>
      )}

      {!loading && (
        <div className="mt-1 text-xs text-slate-700/90">
          Average delay from sending to first click
        </div>
      )}
    </div>
  );
}


/* ======================== Demo graph (styling matches your spec) ======================== */
function DemoReviewsGraph() {
  // Build 12 months of gently increasing totals; only for landing demo
  const now = new Date();
  const labels: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    d.setUTCMonth(d.getUTCMonth() - i);
    labels.push(d.toLocaleString(undefined, { month: "short", year: "numeric" }));
  }
  // Simple, readable trend
  const totals = [3, 4, 4, 5, 6, 7, 9, 10, 11, 13, 14, 16];

  const data = labels.map((label, idx) => ({ x: idx, label, total: totals[idx] }));

  const AXIS = "#64748b"; // slate-500
  const GRID = "#e2e8f0"; // slate-200
  const LINE = "#0f172a"; // slate-900
  const AREA_TOP = "rgba(15, 23, 42, 0.14)";
  const AREA_BOTTOM = "rgba(15, 23, 42, 0.04)";

  const maxTotal = Math.max(...data.map((d) => d.total));
  const yMax = Math.max(maxTotal + 1, Math.ceil((maxTotal * 1.25) / 4) * 4);

  const endIndex = data.length - 1;
  const ticks = data.length > 1 ? [0, endIndex] : [0];
  const tickFormatter = (x: number) =>
    x === 0 ? data[0].label : x === endIndex ? data[endIndex].label : "";

  return (
    <div className="w-full">
      <div className="h-72 w-full sm:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, endIndex + 0.4]}
              ticks={ticks}
              tickFormatter={tickFormatter}
              tick={{ fill: AXIS, fontSize: 12 }}
              tickMargin={8}
              axisLine={{ stroke: GRID }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, yMax]}
              tick={{ fill: AXIS, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickMargin={12}
            />
            <defs>
              <linearGradient id="totalArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AREA_TOP} />
                <stop offset="100%" stopColor={AREA_BOTTOM} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="total"
              stroke="none"
              fill="url(#totalArea)"
              isAnimationActive
            />
            <Line
              dataKey="total"
              type="monotone"
              stroke={LINE}
              strokeWidth={2}
              dot={false}
              activeDot={false}
              isAnimationActive
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
/* ======================== New inverse-layout section ======================== */
function AnalyticsSection() {
  return (
    <section id="analytics" className="relative">
      {/* more space between graph and text */}
      <div className="grid items-center gap-16 lg:gap-24 md:grid-cols-2">
        {/* Left: transparent graph directly on the background */}
        <div className="relative">
          {/* no white card, no border, no shadow */}
          <DemoReviewsGraph />

          {/* Analytics card moved to bottom-right, no “last 90 days” badge */}
          <div className="absolute top-0">
            <TimeToClickCard
              title="Avg. time to first click"
              seconds={43 * 60 + 12} // 43m 12s demo
            />
          </div>
        </div>

        {/* Right: Bold copy */}
        <div className="max-w-xl md:justify-self-end">
          <div className="h-1.5 w-20 rounded-full bg-amber-400/80 mb-6" />
          <h2 className="text-3xl md:text-5xl font-extrabold leading-[1.08] tracking-tight text-slate-900">
            Gain access to insightful analytics
            <br className="hidden md:block" />
            so you can get ahead of feedback
            <br className="hidden md:block" />
            and increase review rates.
          </h2>

          <p className="mt-6 max-w-md text-base md:text-lg text-slate-600">
            Track trends, spot bottlenecks, and know exactly where to focus.
            UpReview turns raw feedback into clear signals that drive more
            five-star reviews.
          </p>

          <ul className="mt-6 space-y-3 text-slate-700">
            <li className="flex items-start gap-3">
              <CheckIcon className="mt-0.5 text-emerald-600" />
              <span>Proactively identify trends and areas for improvement</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon className="mt-0.5 text-emerald-600" />
              <span>Act fast with metrics like time-to-first-click</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon className="mt-0.5 text-emerald-600" />
              <span>Drive repeat clients and more public recommendations</span>
            </li>
          </ul>

          {/* 6) remove the button entirely */}
        </div>
      </div>
    </section>
  );
}


/* =========================== PAGE ============================ */
export default function HomePage() {
  return (
    // 4) more space between sections
    <main className="mx-auto w-full max-w-6xl px-6 pt-24 md:pt-28 pb-12 md:pb-16 space-y-24 md:space-y-28">

      <BackgroundSea />
      <TopNavFixed />

      {/* Hero */}
      <HeroSection />

      {/* Analytics (inverse layout) */}
      <AnalyticsSection />

      {/* 5) Bold heading above the carousel */}
      
      <section id="features" className="space-y-12 center">
        <h2 className="text-center text-3xl md:text-5xl font-extrabold leading-[1.08] tracking-tight text-slate-900">
          Check out our exclusive features
        </h2>
        <FeatureCarousel />
      </section>

      {/* Carousel */}


      {/* 1) Everything below the carousel has been removed */}
    </main>
  );
}


/* =====================================================================
   CLIENTS TABLE DEMO (unchanged below)
===================================================================== */

// Dummy clients
const DEMO_CLIENTS: Array<{
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  added_at: string; // ISO
  email_last_sent_at: string | null;
  click_at: string | null;
  review_submitted_at: string | null;
  sentiment: "good" | "bad" | "unreviewed";
  review: string | null;
  invoice_status: "PAID" | "SENT" | "DRAFT" | "PAID BUT NOT SENT" | null;
}> = [
  {
    id: "c1",
    name: "Alex Morgan",
    email: "alex@example.com",
    phone: "0412 000 111",
    added_at: isoDaysAgo(10),
    email_last_sent_at: null,
    click_at: null,
    review_submitted_at: null,
    sentiment: "unreviewed",
    review: null,
    invoice_status: "DRAFT",
  },
  {
    id: "c2",
    name: "Priya Nair",
    email: "priya@example.com",
    phone: "0413 222 333",
    added_at: isoDaysAgo(20),
    email_last_sent_at: isoDaysAgo(2),
    click_at: isoDaysAgo(2),
    review_submitted_at: isoDaysAgo(1),
    sentiment: "good",
    review:
      "Fantastic experience with UpReview — friendly staff and quick turnaround. Highly recommend!",
    invoice_status: "PAID",
  },
  {
    id: "c3",
    name: "Mark Li",
    email: "mark@example.com",
    phone: "0414 444 555",
    added_at: isoDaysAgo(5),
    email_last_sent_at: null,
    click_at: null,
    review_submitted_at: null,
    sentiment: "unreviewed",
    review: null,
    invoice_status: "SENT",
  },
  {
    id: "c4",
    name: "Sofia Rossi",
    email: "sofia@example.com",
    phone: "0415 666 777",
    added_at: isoDaysAgo(40),
    email_last_sent_at: isoDaysAgo(7),
    click_at: null,
    review_submitted_at: null,
    sentiment: "unreviewed",
    review: null,
    invoice_status: "PAID BUT NOT SENT",
  },
  {
    id: "c5",
    name: "Diego Alvarez",
    email: "diego@example.com",
    phone: "0416 888 999",
    added_at: isoDaysAgo(14),
    email_last_sent_at: isoDaysAgo(3),
    click_at: isoDaysAgo(3),
    review_submitted_at: null,
    sentiment: "bad",
    review:
      "Service was okay but parking was confusing. Team followed up quickly though.",
    invoice_status: "SENT",
  },
];

function ClientsTableDemo() {
  const [selected, setSelected] =
    useState<(typeof DEMO_CLIENTS)[number] | null>(null);

  const sorted = useMemo(() => {
    const copy = [...DEMO_CLIENTS];
    copy.sort((a, b) => {
      const aSent = a.email_last_sent_at ? 1 : 0;
      const bSent = b.email_last_sent_at ? 1 : 0;
      if (aSent !== bSent) return aSent - bSent;
      if (!a.email_last_sent_at && !b.email_last_sent_at) {
        return new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
      }
      return (
        new Date(a.email_last_sent_at || 0).getTime() -
        new Date(b.email_last_sent_at || 0).getTime()
      );
    });
    return copy;
  }, []);

  return (
    <div className="relative">
      {/* Header row */}
      <div className="grid grid-cols-6 gap-4 border-b px-4 py-3 text-left text-sm font-semibold text-gray-700">
        <div>Name</div>
        <div>Email</div>
        <div>Phone</div>
        <div>Added</div>
        <div className="text-center">Invoice Status</div>
        <div className="text-center">Status</div>
      </div>

      {/* Rows */}
      <ul className="divide-y">
        {sorted.map((c) => (
          <li
            key={c.id}
            className="grid grid-cols-6 gap-4 px-4 py-3 text-sm transition cursor-pointer hover:bg-gray-50"
            onClick={() => setSelected(c)}
          >
            <div className="truncate font-medium text-gray-800">{c.name}</div>
            <div className="truncate text-gray-700">{c.email || "—"}</div>
            <div className="truncate text-gray-700">{c.phone || "—"}</div>
            <div className="text-gray-700 whitespace-nowrap">
              {formatDateOnly(c.added_at)}
            </div>
            <div className="justify-self-center self-center">
              <InvoiceStatusBadge status={c.invoice_status} />
            </div>
            <div className="justify-self-center self-center">
              <StatusCell
                emailLastSentAt={c.email_last_sent_at}
                clickAt={c.click_at}
                submittedAt={c.review_submitted_at}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Row click → modal with review */}
      {selected && (
        <Modal
          onClose={() => setSelected(null)}
          title={`Review from ${selected.name}`}
        >
          <ReviewContent
            sentiment={selected.sentiment}
            review={selected.review}
          />
        </Modal>
      )}
    </div>
  );
}

function InvoiceStatusBadge({
  status,
}: {
  status: "PAID" | "SENT" | "DRAFT" | "PAID BUT NOT SENT" | null;
}) {
  let label = status ?? "—";
  let styles = "bg-gray-100 text-gray-700 ring-gray-200";
  switch (status) {
    case "PAID":
      styles = "bg-green-100 text-green-800 ring-green-200";
      break;
    case "SENT":
      styles = "bg-sky-100 text-sky-800 ring-sky-200";
      break;
    case "DRAFT":
      styles = "bg-gray-100 text-gray-700 ring-gray-200";
      break;
    case "PAID BUT NOT SENT":
      styles = "bg-green-100 text-green-800 ring-green-200";
      break;
    default:
      label = "—";
      styles = "bg-gray-100 text-gray-700 ring-gray-200";
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles}`}
    >
      {label}
    </span>
  );
}

function StatusCell({
  emailLastSentAt,
  clickAt,
  submittedAt,
}: {
  emailLastSentAt: string | null;
  clickAt: string | null;
  submittedAt: string | null;
}) {
  let label = "No email sent";
  let when: string | null = null;
  let styles = "bg-gray-100 text-gray-700 ring-gray-200";

  if (submittedAt) {
    label = "Review submitted";
    when = formatDateTime(submittedAt);
    styles = "bg-green-50 text-green-800 ring-green-200";
  } else {
    const clickTime = clickAt ? new Date(clickAt).getTime() : null;
    const emailTime = emailLastSentAt ? new Date(emailLastSentAt).getTime() : null;

    if (clickTime !== null || emailTime !== null) {
      const mostRecent =
        clickTime !== null && emailTime !== null
          ? Math.max(clickTime, emailTime)
          : (clickTime ?? emailTime)!;

      if (clickTime !== null && mostRecent === clickTime) {
        label = "Button clicked";
        when = formatDateTime(clickAt!);
        styles = "bg-amber-50 text-amber-800 ring-amber-200";
      } else if (emailTime !== null) {
        label = "Last email sent";
        when = formatDateTime(emailLastSentAt!);
        styles = "bg-blue-50 text-blue-800 ring-blue-200";
      }
    }
  }
  return (
    <div className="flex flex-col items-center">
      <span
        className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles}`}
      >
        {label}
      </span>
      <span className="mt-1 text-[11px] text-gray-500 whitespace-nowrap">
        {when ?? "—"}
      </span>
    </div>
  );
}

/* =====================================================================
   EMAIL PREVIEW + REVIEW SUBMISSION POP-UP (unchanged)
===================================================================== */

function EmailPreviewDemo() {
  const [open, setOpen] = useState<null | { type: "good" | "bad" }>(null);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="text-sm text-gray-500 mb-3">
        From: UpReview &lt;onboarding@resend.dev&gt;
      </div>
      <div className="prose prose-sm max-w-none">
        <h3 className="m-0">We’d love your feedback</h3>
        <p className="mt-2">
          Hi <strong>Alex</strong>,
        </p>
        <p>
          Thanks for choosing <strong>UpReview</strong>. Your experience matters
          to us, and your feedback helps us improve. If you’re happy, please
          share a public review. If anything fell short, tell us privately so we
          can make it right.
        </p>
        <p>
          We’ve made it simple — pick one option below and you’ll be guided
          through a quick, friendly flow to finish in seconds.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="btn-pulse inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          onClick={() => setOpen({ type: "good" })}
        >
          Happy
        </button>

        <button
          className="btn-pulse inline-flex items-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400"
          onClick={() => setOpen({ type: "bad" })}
        >
          Unsatisfied
        </button>
      </div>

      {open && <ReviewSubmitModal type={open.type} onClose={() => setOpen(null)} />}

      <style jsx>{`
        @keyframes pulse-scale {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.06);
          }
        }
        .btn-pulse {
          animation: pulse-scale 1.8s ease-in-out infinite;
          transform-origin: center;
        }
        .btn-pulse:hover,
        .btn-pulse:focus-visible {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .btn-pulse {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

const DEMO_GOOD_PHRASES = [
  "Friendly staff",
  "Clear explanations",
  "On-time appointment",
  "Easy booking",
  "Great value",
  "Clean facility",
  "Follow-up care",
  "Highly recommend",
  "Professional",
  "Quick turnaround",
  "Listened carefully",
  "No wait time",
  "Went above and beyond",
  "Parking was easy",
  "Modern equipment",
  "Comfortable experience",
  "Excellent communication",
  "Convenient location",
];

function ReviewSubmitModal({
  type,
  onClose,
}: {
  type: "good" | "bad";
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([
    "Friendly staff",
    "Clear explanations",
    "Quick turnaround",
  ]);
  const [text, setText] = useState<string>("");

  const onToggle = (p: string) =>
    setSelected((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );

  const generate = useCallback(() => {
    const chosen = selected.length ? selected : DEMO_GOOD_PHRASES.slice(0, 3);
    const list = chosen.map((s) => s.toLowerCase()).join(", ");
    const out = `I had a great experience with UpReview — ${list}. Booking was easy and the team was professional. Highly recommend!`;
    setText(out);
  }, [selected]);

  useEffect(() => {
    if (type === "good" && !text) generate();
  }, [type]); // eslint-disable-line

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            {type === "good"
              ? "Leave a quick public review"
              : "Tell us what we can improve"}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {type === "good" ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Pick a few phrases and generate a ready-to-send review. You can
              edit it before submitting.
            </p>

            <div className="flex flex-wrap gap-2">
              {DEMO_GOOD_PHRASES.map((p) => {
                const active = selected.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onToggle(p)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
                      active
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                        : "border-gray-300 bg-white text-gray-800"
                    }`}
                  >
                    {p} {active ? <span aria-hidden>×</span> : <span aria-hidden>+</span>}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={generate}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                Generate review
              </button>
              <span className="text-xs text-gray-500">
                You can edit the text below.
              </span>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full min-h-[120px] rounded-lg border border-gray-300 p-3 text-sm"
              placeholder="Write your own review here…"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Submit (demo)
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <textarea
              className="w-full min-h-[140px] rounded-lg border border-gray-300 p-3 text-sm"
              placeholder="Tell us what we can improve…"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Send feedback (demo)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   PHRASES & EXCERPTS DEMO (unchanged)
===================================================================== */

type DemoExcerpt = {
  id: string;
  text: string;
  sentiment: "good" | "bad";
  created_at?: string;
};

type DemoPhrase = {
  id: string;
  phrase: string;
  sentiment: "good" | "bad";
  count: number;
  created_at: string; // ISO
  excerpts: DemoExcerpt[];
};

const DEMO_PHRASES: DemoPhrase[] = [
  {
    id: "p1",
    phrase: "Friendly staff",
    sentiment: "good",
    count: 12,
    created_at: isoDaysAgo(9),
    excerpts: [
      { id: "e1", text: "Everyone was so welcoming and friendly.", sentiment: "good", created_at: isoDaysAgo(8) },
      { id: "e2", text: "Staff went above and beyond to help.", sentiment: "good", created_at: isoDaysAgo(7) },
    ],
  },
  {
    id: "p2",
    phrase: "Clear explanations",
    sentiment: "good",
    count: 8,
    created_at: isoDaysAgo(11),
    excerpts: [{ id: "e3", text: "Everything was explained in plain English.", sentiment: "good", created_at: isoDaysAgo(10) }],
  },
  {
    id: "p3",
    phrase: "Long wait time",
    sentiment: "bad",
    count: 5,
    created_at: isoDaysAgo(13),
    excerpts: [{ id: "e4", text: "Waited over 30 minutes past my booking.", sentiment: "bad", created_at: isoDaysAgo(12) }],
  },
  {
    id: "p4",
    phrase: "Parking was easy",
    sentiment: "good",
    count: 6,
    created_at: isoDaysAgo(30),
    excerpts: [{ id: "e5", text: "Lots of spaces right out front.", sentiment: "good", created_at: isoDaysAgo(29) }],
  },
  {
    id: "p5",
    phrase: "Difficult to contact",
    sentiment: "bad",
    count: 3,
    created_at: isoDaysAgo(16),
    excerpts: [{ id: "e6", text: "Took a while to get a response by phone.", sentiment: "bad", created_at: isoDaysAgo(15) }],
  },
];

function PhrasesExcerptsDemo() {
  const [active, setActive] = useState<DemoPhrase | null>(null);

  const good = DEMO_PHRASES.filter((p) => p.sentiment === "good");
  const bad = DEMO_PHRASES.filter((p) => p.sentiment === "bad");

  return (
    <div className="space-y-8">
      {/* GOOD */}
      <div>
        <div className="mb-2 text-sm font-semibold text-emerald-800">Good</div>
        <ul className="divide-y rounded-2xl border border-gray-200 bg-white shadow-sm">
          {good.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm hover:bg-emerald-50/40 cursor-pointer"
              onClick={() => setActive(p)}
            >
              <div className="col-span-6 truncate font-medium text-gray-900">
                {p.phrase}
              </div>
              <div className="col-span-3 text-gray-700 text-center sm:text-left">
                mentioned {p.count} {p.count === 1 ? "time" : "times"}
              </div>
              <div className="text-gray-600 whitespace-nowrap">
                {formatDateOnly(p.created_at)}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* BAD */}
      <div>
        <div className="mb-2 text-sm font-semibold text-rose-800">Bad</div>
        <ul className="divide-y rounded-2xl border border-gray-200 bg-white shadow-sm">
          {bad.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm hover:bg-rose-50/40 cursor-pointer"
              onClick={() => setActive(p)}
            >
              <div className="col-span-6 truncate font-medium text-gray-900">
                {p.phrase}
              </div>
              <div className="col-span-3 text-gray-700 text-center sm:text-left">
                mentioned {p.count} {p.count === 1 ? "time" : "times"}
              </div>
              <div className="text-gray-600 whitespace-nowrap">
                {formatDateOnly(p.created_at)}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Phrase click → excerpts modal */}
      {active && <ExcerptsModal phrase={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function ExcerptsModal({
  phrase,
  onClose,
}: {
  phrase: DemoPhrase;
  onClose: () => void;
}) {
  const excerptsToShow = useMemo(() => {
    const target = Math.max(0, Math.min(phrase.count ?? 0, 10));
    const seeds = Array.isArray(phrase.excerpts) ? phrase.excerpts : [];
    if (seeds.length >= target) return seeds.slice(0, target);
    const out: DemoExcerpt[] = [...seeds];
    for (let i = seeds.length; i < target; i++) {
      out.push({
        id: `g${phrase.id}-${i}`,
        sentiment: phrase.sentiment,
        text: synthLineForPhrase(phrase.phrase, phrase.sentiment, i),
        created_at: isoDaysAgo(Math.max(1, i + 1)),
      });
    }
    return out;
  }, [phrase]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-[680px] max-w-[94vw] max-h-[80vh] overflow-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl ring-1 ring-black/5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className="text-base md:text-lg font-semibold tracking-tight text-gray-900 truncate">
              {phrase.phrase}
            </h3>
            <span className="text-xs text-gray-500 shrink-0">
              Showing {excerptsToShow.length}{" "}
              {excerptsToShow.length === 1 ? "excerpt" : "excerpts"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {excerptsToShow.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            No excerpts yet for this phrase.
          </div>
        ) : (
          <ul className="space-y-2 pr-1">
            {excerptsToShow.map((e) => {
              const isGood = e.sentiment === "good";
              const wrap = isGood
                ? "border-emerald-100 bg-emerald-50/70 text-emerald-900"
                : "border-rose-100 bg-rose-50/80 text-rose-900";
              const badge = isGood
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-rose-50 text-rose-800 ring-rose-200";
              return (
                <li
                  key={e.id}
                  className={`rounded-lg border px-3 py-2 text-xs ${wrap}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${badge}`}
                    >
                      {isGood ? "good" : "bad"}
                    </span>
                    {e.created_at && (
                      <span className="text-[10px] text-gray-600 whitespace-nowrap">
                        {formatDateTime(e.created_at)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 leading-snug">{e.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function synthLineForPhrase(
  phrase: string,
  sentiment: "good" | "bad",
  i: number
) {
  const base =
    sentiment === "good"
      ? [
          `Really appreciated the ${phrase.toLowerCase()}.`,
          `The ${phrase.toLowerCase()} stood out for me.`,
          `${phrase} made the whole experience better.`,
          `Noticed the ${phrase.toLowerCase()} right away.`,
          `Loved the ${phrase.toLowerCase()} — thank you!`,
        ]
      : [
          `${phrase} was an issue this time.`,
          `Experienced ${phrase.toLowerCase()} during my visit.`,
          `${phrase} could be improved.`,
          `Ran into ${phrase.toLowerCase()} unfortunately.`,
          `${phrase} is something to work on.`,
        ];
  return base[i % base.length];
}

/* =====================================================================
   SHARED PRIMITIVES (unchanged)
===================================================================== */

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="text-sm text-gray-800">{children}</div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewContent({
  sentiment,
  review,
}: {
  sentiment: "good" | "bad" | "unreviewed";
  review: string | null;
}) {
  const hint = useMemo(() => {
    const v = sentiment?.toLowerCase();
    if (v === "good") return "This client left a positive sentiment.";
    if (v === "bad") return "This client left a negative sentiment.";
    return "This client hasn’t been reviewed yet.";
  }, [sentiment]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Sentiment:</span>
        <span className="inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 bg-gray-100 text-gray-700 ring-gray-200">
          {hint}
        </span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-800">
        {review?.trim() ? (
          <p className="whitespace-pre-wrap leading-relaxed">{review}</p>
        ) : (
          <p className="text-gray-500">No review text provided.</p>
        )}
      </div>
    </div>
  );
}

function AuthButtonsFixed() {
  return (
    <div className="fixed top-4 right-4 z-40">

        <Link
          href={ROUTES.SIGN_UP}
          aria-label="Sign up"
          className="inline-flex items-center rounded-xl px-6 py-2.5 text-base font-semibold text-white shadow-md shadow-blue-600/20
                     bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-95 active:scale-[0.98] transition"
        >
          Try now
        </Link>
    </div>
  );
}

/* =====================================================================
   UTILS
===================================================================== */
function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
