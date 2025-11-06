// components/ui/background-sea.tsx
import * as React from "react";

export type BackgroundSeaProps = {
  /** Extra classes for the outer wrapper (e.g., responsive visibility) */
  className?: string;
  /** z-index for the wrapper (defaults to -10 to sit behind content) */
  zIndex?: number;
  /** Show the subtle grain layer */
  showGrain?: boolean;
};

/**
 * BackgroundSea
 * Fixed, full-viewport background with a pale vertical gradient,
 * soft blurred blobs, and optional subtle grain for depth.
 *
 * Usage:
 *   import BackgroundSea from "@/components/ui/background-sea";
 *   ...
 *   <BackgroundSea />
 */
export default function BackgroundSea({
  className,
  zIndex = -10,
  showGrain = true,
}: BackgroundSeaProps) {
  const base =
    "pointer-events-none fixed inset-0";
  const cls = [base, className].filter(Boolean).join(" ");

  return (
    <div className={cls} style={{ zIndex }} aria-hidden="true">
      {/* base gentle vertical gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-50 via-sky-50/70 to-white" />

      {/* soft blurred shapes (like distant sea/light) */}
      <div className="absolute -top-24 -left-32 h-80 w-80 rounded-full bg-sky-200/35 blur-3xl" />
      <div className="absolute top-40 -right-24 h-72 w-72 rounded-full bg-indigo-200/30 blur-3xl" />
      <div className="absolute bottom-[-6rem] left-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-200/25 blur-[90px]" />

      {/* subtle grain for depth (very faint) */}
      {showGrain && (
        <div
          className="absolute inset-0 mix-blend-multiply"
          style={{
            opacity: 0.04,
            backgroundImage:
              "radial-gradient(transparent 0, rgba(0,0,0,.07) 100%)",
            backgroundSize: "2px 2px",
          }}
        />
      )}
    </div>
  );
}
