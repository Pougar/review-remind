// app/lib/auth.ts
import { betterAuth } from "better-auth";
import pg from "pg";
import { nextCookies } from "better-auth/next-js";

const AUTH_DB_URL = process.env.DATABASE_URL_AUTH ?? process.env.DATABASE_URL;
if (!AUTH_DB_URL) throw new Error("Missing DATABASE_URL_AUTH or DATABASE_URL");

const pool = new pg.Pool({
  connectionString: AUTH_DB_URL,
  ssl: { rejectUnauthorized: true },
});

// ✅ Ensure queries see auth.* tables (Neon-friendly: runs AFTER connect)
pool.on("connect", (client) => {
  client
    .query(`SET search_path TO auth, public`)
    .catch((e) => console.error("Failed to SET search_path", e));
});


export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true },
  trustedOrigins: ["http://localhost:3000", "*.vercel.app", "https://your-production-domain.com"],
  plugins: [nextCookies()],
  account: {
        accountLinking: {
            enabled: true, 
            allowDifferentEmails: true,
        }
    },
    socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      accessType: "offline",
      prompt: "consent",
      // helpful when you add scopes later
      includeGrantedScopes: true,
      // request the Business Profile scope:
      scopes: ["https://www.googleapis.com/auth/business.manage"],
    },
  },
});
