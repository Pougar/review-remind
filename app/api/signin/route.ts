import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import bcrypt from "bcrypt";

// Connect to your Neon DB
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' }); // make sure DATABASE_URL is in .env

export async function POST(req: NextRequest) {
  
  const { email, password } = await req.json();
  console.log("Signup payload:", { email, password });
  if (!email || !password) {
    return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
  }

  // Query the database
  const user = await sql`
    SELECT * FROM users
    WHERE email = ${email}
  `;

  if (user.length === 0) {
    try {
        // Insert a new user
        const hashed = await bcrypt.hash(password, 10);
        const newUser = await sql`
          INSERT INTO users (email, password)
          VALUES (${email}, ${hashed})
          RETURNING *
        `;
    
        return NextResponse.json({ success: true, user: newUser[0], message: 'Account creation successful', ok: true});
      } catch (err) {
        console.error(err);
        return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
      }
  }
  if (user.length > 0) {
    return NextResponse.json({ success: false, redirect: true, message: 'This email is already registered with us\nRedirecting you to login page...'});
  }

}
