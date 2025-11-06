// app/api/businesses/swap-primary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- PG Pool singleton ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolSwapPrimaryBiz: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolSwapPrimaryBiz) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");

    global._pgPoolSwapPrimaryBiz = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolSwapPrimaryBiz;
}

/* ---------- Helpers ---------- */
function isUUID(v?: string | null) {
  return !!v && /^[0-9a-fA-F-]{36}$/.test(v);
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: "INVALID_INPUT", message, ...extra },
    { status: 400 }
  );
}
function unauthorized(message = "Sign in required.") {
  return NextResponse.json(
    { error: "UNAUTHORIZED", message },
    { status: 401 }
  );
}
function forbidden(message = "Not allowed or not accessible.") {
  return NextResponse.json({ error: "FORBIDDEN", message }, { status: 403 });
}
function notFound(message = "Not found.") {
  return NextResponse.json({ error: "NOT_FOUND", message }, { status: 404 });
}
function serverError(message = "Server error.") {
  return NextResponse.json(
    { error: "SERVER_ERROR", message },
    { status: 500 }
  );
}

/* ---------- Types ---------- */
type ReqBody = {
  currentBusinessId?: string;   // UUID of currently "primary"
  newBusinessName?: string;     // display_name of new business to make primary
};

type NewBizRow = {
  id: string;
  slug: string;
};

type XeroRow = {
  business_id: string;
  is_primary: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ReqBody;
  const currentBusinessId = (body?.currentBusinessId || "").trim();
  const newBusinessName = (body?.newBusinessName || "").trim();

  if (!isUUID(currentBusinessId)) {
    return badRequest("currentBusinessId must be a valid UUID.", {
      field: "currentBusinessId",
    });
  }
  if (!newBusinessName) {
    return badRequest("newBusinessName is required.", {
      field: "newBusinessName",
    });
  }

  // auth for RLS
  const session = await auth.api.getSession({ headers: req.headers });
  const userId = session?.user?.id;
  if (!userId) {
    return unauthorized();
  }

  const pool = getPool();
  const db: PoolClient = await pool.connect();

  try {
    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // 1. Find new business by its display_name (case-insensitive), grab slug for redirect
    const newBizQ = await db.query<NewBizRow>(
      `
      SELECT b.id, b.slug
      FROM public.businesses b
      WHERE LOWER(b.display_name) = LOWER($1)
      LIMIT 1
      `,
      [newBusinessName]
    );

    if (newBizQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return notFound(
        "No business found with that name (or you don't have access to it)."
      );
    }

    const newBusinessId = newBizQ.rows[0].id;
    const newBusinessSlug = newBizQ.rows[0].slug;

    // 2. Lock Xero rows for both
    const xeroQ = await db.query<XeroRow>(
      `
      SELECT xd.business_id, xd.is_primary
      FROM integrations.xero_details xd
      WHERE xd.business_id = ANY($1::uuid[])
      FOR UPDATE
      `,
      [[currentBusinessId, newBusinessId]]
    );

    const haveCurrent = xeroQ.rows.some(
      (r) => r.business_id === currentBusinessId
    );
    const haveNew = xeroQ.rows.some(
      (r) => r.business_id === newBusinessId
    );

    if (!haveCurrent || !haveNew) {
      await db.query("ROLLBACK");
      return notFound(
        "Xero details not found for one or both businesses. Cannot swap primary."
      );
    }

    // 3. Flip flags
    const unsetQ = await db.query(
      `
      UPDATE integrations.xero_details
      SET is_primary = FALSE
      WHERE business_id = $1::uuid
      `,
      [currentBusinessId]
    );

    const setQ = await db.query(
      `
      UPDATE integrations.xero_details
      SET is_primary = TRUE
      WHERE business_id = $1::uuid
      `,
      [newBusinessId]
    );

    if (unsetQ.rowCount === 0 || setQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return forbidden(
        "Could not update primary flags. You may not have permission."
      );
    }

    await db.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        currentBusinessId,
        newBusinessId,
        newBusinessSlug, // <-- client will redirect to this slug
      },
      { status: 200 }
    );
  } catch (err: any) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("[swap-primary] error:", err?.stack || err?.message || err);

    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("row-level security")) {
      return forbidden(
        "Permission denied by row-level security. You may not be allowed to modify these businesses."
      );
    }

    return serverError();
  } finally {
    db.release();
  }
}
