// app/api/businesses/slug-availability/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton across hot reloads; no eslint-disable, no `any`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolBusinessSlugAvail?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolBusinessSlugAvail) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolBusinessSlugAvail = new Pool({
      connectionString: cs,
      // Neon typically needs SSL unless your URL has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolBusinessSlugAvail;
}

/** ---------- Helpers ---------- */
function normalizeSlug(input: string, maxLen = 60): string {
  const noMarks = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = noMarks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");
  return cleaned;
}

const RESERVED = new Set([
  "admin",
  "api",
  "assets",
  "auth",
  "business",
  "businesses",
  "client",
  "clients",
  "dashboard",
  "docs",
  "help",
  "home",
  "images",
  "login",
  "log-in",
  "logout",
  "log-out",
  "maps",
  "new",
  "public",
  "settings",
  "signup",
  "sign-up",
  "static",
  "upload",
  "uploads",
]);

type IdRow = { id: string };

/** ---------- GET /api/businesses/slug-availability?slug=&excludeId= ---------- */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawSlug = (searchParams.get("slug") || "").trim();
    const excludeId = ((searchParams.get("excludeId") || "").trim() || null) as string | null;

    if (!rawSlug) {
      return NextResponse.json({ available: false, reason: "MISSING_SLUG" }, { status: 400 });
    }

    const normalized = normalizeSlug(rawSlug);

    // basic validation
    if (!normalized) {
      return NextResponse.json(
        { available: false, normalized, reason: "INVALID_SLUG" },
        { status: 400 }
      );
    }
    if (normalized.length < 2) {
      return NextResponse.json(
        { available: false, normalized, reason: "TOO_SHORT" },
        { status: 400 }
      );
    }
    if (RESERVED.has(normalized)) {
      return NextResponse.json(
        { available: false, normalized, reason: "RESERVED" },
        { status: 200 }
      );
    }

    const pool = getPool();

    // Check for conflicts (case-insensitive), ignoring soft-deleted rows.
    // When updating an existing business, exclude that row by id.
    const q = await pool.query<IdRow>(
      `
      SELECT id
      FROM public.businesses
      WHERE deleted_at IS NULL
        AND lower(slug) = lower($1)
        AND ( $2::uuid IS NULL OR id <> $2::uuid )
      LIMIT 1
      `,
      [normalized, excludeId]
    );

    const available = q.rowCount === 0;

    return NextResponse.json(
      {
        available,
        normalized,
        reason: available ? "OK" : "TAKEN",
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[/api/businesses/slug-availability] error:", msg);
    return NextResponse.json({ available: false, reason: "SERVER_ERROR" }, { status: 500 });
  }
}
