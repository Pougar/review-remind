// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import postgres from "postgres";
import bcrypt from "bcrypt";
import type { NextAuthOptions, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        // 1. Look up user in your database
        const users = await sql`
          SELECT id, email, password
          FROM users
          WHERE email = ${credentials.email}
        `;
        const user = users[0]; // postgres returns an array of rows

        if (!user) return null;

        // 2. Compare hashed password
        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;

        // 3. Return safe user object
        return { id: user.id, email: user.email };
      },
    }),
  ],
  pages: {
    signIn: "/login", // optional custom login page
  },
  session: {
    strategy: "jwt", // stores session in HTTP-only cookies
  },
  callbacks: {
    async session({ session, token }: { session: Session; token: JWT }) {
        session.user.id = token.sub as string;
        return session;
    },
  },
};

// App Router requires export of GET and POST handlers
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
