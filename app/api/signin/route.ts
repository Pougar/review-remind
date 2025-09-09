import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import bcrypt from "bcrypt";

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
    WHERE email = ${emailValue}
  `;

  if (user.length === 0) {
    try {
        // Insert a new user
        const hashed = await bcrypt.hash(passValue, 10);
        const newUser = await sql`
          INSERT INTO users (email, password)
          VALUES (${emailValue}, ${hashed})
          RETURNING *
        `;
    
        return NextResponse.json({ success: true, user: newUser[0], message: 'Account creation successful' });
      } catch (err) {
        console.error(err);
        return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
      }
  }
  if (user.length > 0) {
    return NextResponse.json({ success: false, message: 'This email is already registered with us' });
  }

}
