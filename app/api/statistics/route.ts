import postgres from "postgres";
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getServerSession } from "next-auth/next";

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

export async function GET(req: NextRequest){

    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = session.user.id;

        const rows = await sql`
        SELECT review, COUNT(*) AS count
        FROM clients
        WHERE user_id = ${userId}
        GROUP BY review
        `;
    
    return NextResponse.json(rows.map(row => ({
            review: row.review,
            count: Number(row.count)
          })));

}