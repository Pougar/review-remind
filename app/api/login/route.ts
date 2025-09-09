
import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

// Connect to your Neon DB
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' }); // make sure DATABASE_URL is in .env

export async function POST(req: NextRequest) {
  
  const { emailValue, passValue } = await req.json();

  if (!emailValue || !passValue) {
    return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
  }

  // Query the database
  const user = await sql`
    SELECT * FROM users
    WHERE email = ${emailValue} AND password = ${passValue}
  `;

  if (user.length === 0) {
    return NextResponse.json({ success: false, message: 'Invalid email or password' });
  }
  if (user.length > 1) {
    return NextResponse.json({ success: false, message: 'Multiple users with same email and password? - Check with support team' });
  }

  return NextResponse.json({ success: true, user: user[0], message: 'Login successful' });
}
