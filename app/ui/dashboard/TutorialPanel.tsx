"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { ROUTES } from "@/app/lib/constants";

/* ---------- Types (exclusive union; no optional 'never') ---------- */
type StepBase = {
  title: string;
  text: ReactNode; // allow richer formatting
  icon: ReactNode;
  cta?: string;
};

type Step =
  | (StepBase & { href: string })                               // single link
  | (StepBase & { hrefs: { label: string; href: string }[] });  // multiple links

/* ---------- Icons ---------- */
const IconAnalytics = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path d="M3 3h2v18H3V3Zm16 9h2v9h-2v-9ZM11 8h2v13h-2V8Zm-4 5h2v8H7v-8Zm8-9h2v17h-2V4Z" fill="currentColor" />
  </svg>
);

const IconAutomation = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path
      d="M19.14 12.94a7.963 7.963 0 0 0 .06-.94 7.963 7.963 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.056 7.056 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13 1h-4a.5.5 0 0 0-.49.42L8.15 3.96a7.056 7.056 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L1.62 7.48a.5.5 0 0 0 .12.64L3.77 9.7c-.04.31-.07.63-.07.96s.03.65.07.96l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.39.32.6.22l2.39-.96c.49.39 1.04.71 1.63.94l.36 2.54c.05.24.25.42.49.42h4c.24 0 .45-.18.49-.42l.36-2.54c.59-.23 1.14-.55 1.63-.94l2.39.96c.21.09.47.01.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM11 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"
      fill="currentColor"
    />
  </svg>
);

const IconSettings = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path
      d="M12 8a4 4 0 1 1-.001 7.999A4 4 0 0 1 12 8Zm8.94 4a7.963 7.963 0 0 0 .06-.94 7.963 7.963 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.056 7.056 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13 1h-2a.5.5 0 0 0-.49.42L10.15 3.96a7.056 7.056 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L3.62 7.48a.5.5 0 0 0 .12.64L5.77 9.7c-.04.31-.07.63-.07.96s.03.65.07.96l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.39.32.6.22l2.39-.96c.49.39 1.04.71 1.63.94l.36 2.54c.05.24.25.42.49.42h2c.24 0 .45-.18.49-.42l.36-2.54c.59-.23 1.14-.55 1.63-.94l2.39.96c.21.09.47.01.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58Z"
      fill="currentColor"
    />
  </svg>
);

/* ---------- Component ---------- */
export default function TutorialPanel(props: { slug?: string | null; businessSlug?: string | null }) {
  // Read from props if provided, else fall back to the route params
  const params = useParams() as { slug?: string; bslug?: string };
  const slug = (props.slug ?? params.slug ?? "").toString();
  const businessSlug = (props.businessSlug ?? params.bslug ?? "").toString();

  const hasContext = slug && businessSlug;
  const href = {
    analytics: hasContext ? ROUTES.DASHBOARD_ANALYTICS(slug, businessSlug) : "#",
    clients: hasContext ? ROUTES.DASHBOARD_CLIENTS(slug, businessSlug) : "#",
    settings: hasContext ? ROUTES.DASHBOARD_BUSINESS_SETTINGS(slug, businessSlug) : "#",
  };

  const steps: Step[] = [
    {
      title: "Centralised analytics across platforms",
      text: (
        <>
          We aggregate your reviews across services and apply AI to surface insights and
          trends (good vs bad mentions, excerpts, and volume over time). Everything is in
          one place—no more tab-hopping.
          <ul className="mt-2 list-disc pl-5 text-gray-600">
            <li>See phrases and real excerpts from real reviews.</li>
            <li>Track total, good, and bad reviews by day or month.</li>
          </ul>
        </>
      ),
      href: href.analytics,
      cta: "Open Analytics",
      icon: IconAnalytics,
    },
    {
      title: "Intelligently automate review reminders",
      text: (
        <>
          Import clients from Xero, then let Upreview nudge the right people at the right
          time—without being intrusive. You’re always in control of who gets contacted.
          <ul className="mt-2 list-disc pl-5 text-gray-600">
            <li>Manage recipients directly on your Clients page.</li>
            <li>Customize the email content and branding.</li>
          </ul>
        </>
      ),
      hrefs: [
        { label: "Open Clients", href: href.clients },
        { label: "Business Settings", href: href.settings },
      ],
      cta: "Automations",
      icon: IconAutomation,
    },
    {
      title: "Lower the barrier to writing reviews",
      text: (
        <>
          Customers can pick aspects of your service (your phrases) and let AI draft a
          polished review in seconds. After submitting, they’re automatically redirected
          to your Google review page to post it publicly.
          <ul className="mt-2 list-disc pl-5 text-gray-600">
            <li>Edit the phrase list to match your business.</li>
            <li>Encourage fast, high-quality, on-brand reviews.</li>
          </ul>
        </>
      ),
      href: href.settings,
      cta: "Review Settings",
      icon: IconSettings,
    },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      {/* Header */}
      <div className="mb-1 flex items-center gap-2 text-gray-900">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-indigo-600" aria-hidden="true">
          <path
            d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"
            fill="currentColor"
          />
        </svg>
        <h2 className="text-base font-semibold">Getting started with Upreview</h2>
      </div>
      <p className="text-sm text-gray-600">
        Upreview helps your business in <span className="font-medium text-gray-800">three main ways</span>.
        Explore each area below.
      </p>

      {/* Steps */}
      <ol className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold ring-1 ring-indigo-200">
                {i + 1}
              </span>
              <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-900">
                {s.icon}
                {s.title}
              </span>
            </div>

            <div className="text-sm text-gray-700">{s.text}</div>

            <div className="mt-3 flex flex-wrap gap-2">
              {"href" in s ? (
                <Link
                  href={s.href}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50 aria-disabled:opacity-50"
                  aria-disabled={!hasContext}
                >
                  {s.cta ?? "Open"}
                  <span aria-hidden>→</span>
                </Link>
              ) : (
                s.hrefs.map((h) => (
                  <Link
                    key={h.href}
                    href={h.href}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50 aria-disabled:opacity-50"
                    aria-disabled={!hasContext}
                  >
                    {h.label}
                    <span aria-hidden>→</span>
                  </Link>
                ))
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Small tips footer (optional, keeps the style consistent) */}
      <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        Tip: You can always revisit this tutorial from the bottom of the dashboard. Start by opening <span className="font-medium text-gray-800">Analytics</span> to
        see phrases and real excerpts from real reviews.
      </div>
    </div>
  );
}
