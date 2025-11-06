// app/api/settings/review-settings/delete-phrase/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
declare global {
  var _pgPoolDeletePhrase: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolDeletePhrase) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolDeletePhrase = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false }, // match your other routes
      max: 5,
    });
  }
  return global._pgPoolDeletePhrase;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- Helpers ---------- */
const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

type ReqBody = {
  businessId?: string;
  phraseId?: string;
};

type DeleteResp = {
  success: boolean;
  businessId: string;
  phrase_id: string;
  deleted_excerpts: number;
};

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client: PoolClient = await pool.connect();

  try {
    // --- Auth via BetterAuth (for RLS) ---
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // --- Parse input ---
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const businessIdRaw = body?.businessId?.trim();
    const phraseIdRaw = body?.phraseId?.trim();

    if (!isUUID(businessIdRaw) || !isUUID(phraseIdRaw)) {
      return NextResponse.json(
        {
          error: "INVALID_INPUT",
          message: "Valid businessId and phraseId are required.",
        },
        { status: 400 }
      );
    }

    // From this point on, we know they're valid UUID strings.
    // Narrow them for TypeScript.
    const businessId = businessIdRaw as string;
    const phraseId = phraseIdRaw as string;

    // --- Start tx + satisfy RLS with app.user_id ---
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // 1. Check that the phrase really belongs to this business
    //    and that, under RLS, this user can see it.
    const phraseCheck = await client.query<{ id: string }>(
      `
      SELECT p.id
      FROM public.phrases p
      WHERE p.id = $1
        AND p.business_id = $2
      LIMIT 1
      `,
      [phraseId, businessId]
    );

    if (phraseCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "NOT_ALLOWED_OR_NOT_FOUND",
          message:
            "Either that phrase does not exist, does not belong to this business, or you do not have access.",
        },
        { status: 404 }
      );
    }

    // 2. Count excerpts linked to this phrase (scoped to same business).
    //    We scope with EXISTS same as analytics route.
    const countExcerptsRes = await client.query<{ cnt: string }>(
      `
      SELECT COUNT(*)::text AS cnt
      FROM public.excerpts e
      WHERE e.phrase_id = $1
        AND EXISTS (
          SELECT 1
          FROM public.phrases p2
          WHERE p2.id = e.phrase_id
            AND p2.business_id = $2
        )
      `,
      [phraseId, businessId]
    );

    const deletedExcerptsCountBeforeDelete = parseInt(
      countExcerptsRes.rows?.[0]?.cnt || "0",
      10
    );

    // 3. Delete excerpts for this phrase (again scoped by business)
    await client.query(
      `
      DELETE FROM public.excerpts e
      WHERE e.phrase_id = $1
        AND EXISTS (
          SELECT 1
          FROM public.phrases p2
          WHERE p2.id = e.phrase_id
            AND p2.business_id = $2
        )
      `,
      [phraseId, businessId]
    );

    // 4. Delete the phrase itself.
    const delPhraseRes = await client.query<{ id: string }>(
      `
      DELETE FROM public.phrases p
      WHERE p.id = $1
        AND p.business_id = $2
      RETURNING p.id
      `,
      [phraseId, businessId]
    );

    if (delPhraseRes.rowCount === 0) {
      // Race condition / RLS block at delete time
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "DELETE_FAILED",
          message:
            "Phrase could not be deleted (it may have already been removed).",
        },
        { status: 409 }
      );
    }

    await client.query("COMMIT");

    const resp: DeleteResp = {
      success: true,
      businessId,
      phrase_id: phraseId,
      deleted_excerpts: deletedExcerptsCountBeforeDelete,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }

    const e = err instanceof Error ? err : new Error(String(err));
    const msg = e.message ?? "";
    if (msg.toLowerCase().includes("row-level security")) {
      return NextResponse.json(
        {
          error: "RLS_DENIED",
          message: "Permission denied by row-level security.",
        },
        { status: 403 }
      );
    }

    console.error(
      "[/api/settings/review-settings/delete-phrase] error:",
      e.stack ?? e
    );

    return NextResponse.json(
      { error: "SERVER_ERROR", message: "Could not delete phrase." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
