"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable data access.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(
      "Supabase is not configured correctly. NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL.",
    );
  }

  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search.length > 0 ||
    parsedUrl.hash.length > 0
  ) {
    throw new Error(
      "Supabase is not configured correctly. NEXT_PUBLIC_SUPABASE_URL must be the HTTP(S) project root URL without a REST path, query, or fragment.",
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
