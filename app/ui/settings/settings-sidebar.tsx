// app/ui/settings/settings-sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";

export default function SettingsSidebar() {
  const pathname = usePathname();
  const params = useParams() as { slug?: string; bslug?: string };

  const accountSlug = params.slug ?? "";
  const businessSlug = params.bslug ?? "";
  const base = `/dashboard/${accountSlug}/${businessSlug}/settings`;

  const links = [
    { label: "Business Settings", href: `${base}/business-settings` },
    { label: "Email Settings", href: `${base}/email-settings` },
    { label: "Review Settings", href: `${base}/review-settings` },
  ];

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-48 shrink-0 border-r border-gray-100 bg-white">
      {/* matches analytics: spacer header + bottom border */}
      <div className="px-4 pt-8 pb-8 border-b border-gray-100" />
      <nav className="py-3">
        <ul className="flex flex-col">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className="relative flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
