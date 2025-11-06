import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { verifyMagicToken } from "@/app/lib/magic-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool =
  (globalThis as any).__pgPoolPublicBusiness ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
(globalThis as any).__pgPoolPublicBusiness = pool;

/* ------------------ Helpers ------------------ */
const isUUID = (v?: string | null) =>
  !!v && /^[0-9a-fA-F-]{36}$/.test(v);

// ✅ new: allow "test"
const isClientIdPublicValid = (cid?: string | null) => {
  if (!cid) return false;
  if (cid === "test") return true;
  return isUUID(cid);
};

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: "INVALID_INPUT", message, ...extra },
    { status: 400 }
  );
}

function forbidden(message: string) {
  return NextResponse.json(
    { error: "INVALID_TOKEN", message },
    { status: 403 }
  );
}

function serverError(message = "Could not load business details.") {
  return NextResponse.json(
    { error: "INTERNAL", message },
    { status: 500 }
  );
}

const SQL_GET_BUSINESS = `
  SELECT
    id,
    slug,
    display_name,
    description,
    google_review_link
  FROM public.businesses
  WHERE id = $1
    AND deleted_at IS NULL
  LIMIT 1
` as const;

/* ------------------ POST ------------------ */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    businessId?: string;
    clientId?: string;
    token?: string;
  };

  const businessId = body.businessId?.trim() || "";
  const clientId   = body.clientId?.trim() || "";
  const token      = body.token?.trim() || "";

  // validate
  if (!isUUID(businessId)) {
    return badRequest("Valid businessId is required.", { field: "businessId" });
  }

  // ✅ use isClientIdPublicValid here instead of isUUID
  if (!isClientIdPublicValid(clientId)) {
    return badRequest("Valid clientId is required.", { field: "clientId" });
  }

  if (!token) {
    return badRequest("token is required.", { field: "token" });
  }

  // verify token still matches businessId/clientId (even "test")
  const check = verifyMagicToken({
    token,
    businessId,
    clientId,
  });

  if (!check.ok) {
    return forbidden(check.error);
  }

  const dbClient = await pool.connect();
  try {
    const { rows } = await dbClient.query(SQL_GET_BUSINESS, [businessId]);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found." },
        { status: 404 }
      );
    }

    const row = rows[0];

    return NextResponse.json(
      {
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        description: row.description,
        google_review_link: row.google_review_link,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    console.error("[/api/public/get-business-details] error:", err);
    return serverError();
  } finally {
    dbClient.release();
  }
}

/* ------------------ GET (optional) ------------------ */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const businessId = (url.searchParams.get("businessId") ?? "").trim();
  const clientId   = (url.searchParams.get("clientId") ?? "").trim();
  const token      = (url.searchParams.get("token") ?? "").trim();

  if (!isUUID(businessId)) {
    return badRequest("Valid businessId is required.", { field: "businessId" });
  }

  // ✅ again
  if (!isClientIdPublicValid(clientId)) {
    return badRequest("Valid clientId is required.", { field: "clientId" });
  }

  if (!token) {
    return badRequest("token is required.", { field: "token" });
  }

  const check = verifyMagicToken({
    token,
    businessId,
    clientId,
  });

  if (!check.ok) {
    return forbidden(check.error);
  }

  const dbClient = await pool.connect();
  try {
    const { rows } = await dbClient.query(SQL_GET_BUSINESS, [businessId]);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found." },
        { status: 404 }
      );
    }

    const row = rows[0];

    return NextResponse.json(
      {
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        description: row.description,
        google_review_link: row.google_review_link,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    console.error("[/api/public/get-business-details] GET error:", err);
    return serverError();
  } finally {
    dbClient.release();
  }
}
