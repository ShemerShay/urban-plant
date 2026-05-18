import { neon } from "@neondatabase/serverless";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  }
  return url;
}

/** Serverless SQL client for Neon (HTTP). Use in Route Handlers and Server Components. */
export const sql = neon(getDatabaseUrl());
