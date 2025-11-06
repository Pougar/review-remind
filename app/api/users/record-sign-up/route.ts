import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId } = body as { userId?: string };

    if (!userId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId is required" },
        { status: 400 }
      );
    }

    // Insert into user_actions
    await pool.query(
      `INSERT INTO user_actions (user_id, action)
       VALUES ($1, 'signed_in')`,
      [userId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error recording sign-in:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not record sign-in" },
      { status: 500 }
    );
  }
}
