// app/api/upload-company-logo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseServer";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

declare global {
  // eslint-disable-next-line no-var
  var _pgPoolUploadLogo: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolUploadLogo) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolUploadLogo = new Pool({
      connectionString: cs,
      // Neon/managed PG often needs this false; flip to true if your certs are set up
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolUploadLogo;
}

const BUCKET = "company-logos";

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // ---- Auth (BetterAuth): needed for RLS (app.user_id) ----
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const businessId = form.get("businessId") as string | null;

    if (!file || !businessId) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (!isUUID(businessId)) {
      return NextResponse.json({ error: "INVALID_BUSINESS_ID" }, { status: 400 });
    }

    // Ensure updates run under this user for RLS
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Build storage path
    const rawName = (file.name || "").trim();
    const ext = (rawName.split(".").pop() || "png").toLowerCase();
    const path = `${businessId}/logo.${ext}`;

    // Upload (upsert)
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "image/png",
      });

    if (uploadErr) {
      console.error("[upload-company-logo] upload error:", uploadErr);
      return NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
    }

    // Store the *path* in DB (stable pointer). Your get-logo-url API can mint a signed URL from this.
    const upd = await client.query(
      `
      UPDATE public.businesses
         SET company_logo_url = $1,
             updated_at = NOW()
       WHERE id = $2
       RETURNING id
      `,
      [path, businessId]
    );

    if (upd.rowCount === 0) {
      return NextResponse.json({ error: "BUSINESS_NOT_FOUND" }, { status: 404 });
    }

    // Short-lived signed URL for immediate preview (do not persist this)
    const { data: signed, error: signedErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60); // 1 hour

    if (signedErr) {
      // Not fatal—path is already saved
      console.warn("[upload-company-logo] signed URL error:", signedErr);
    }

    return NextResponse.json({
      success: true,
      businessId,
      path,                         // what we saved in DB (stable)
      signedUrl: signed?.signedUrl || null, // for immediate preview
    });
  } catch (e) {
    console.error("[upload-company-logo] INTERNAL ERROR:", e);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    client.release();
  }
}
