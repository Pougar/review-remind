// app/lib/auth-client.ts
"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
// no baseURL → it uses window.location.origin in the browser
