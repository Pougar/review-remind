import NextAuth, { DefaultSession, DefaultUser } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string; // add user id
    };
  }

  interface User extends DefaultUser {
    id: string; // add user id
  }
}
