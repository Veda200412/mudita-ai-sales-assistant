import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  getSupabasePublicConfig,
  requireServerEnvironment,
} from "@/lib/config";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseServerClient() {
  const { url, anonKey } = getSupabasePublicConfig();

  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createSupabaseAdminClient() {
  requireServerEnvironment([
    "supabaseUrl",
    "supabaseServiceRoleKey",
  ]);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server configuration is incomplete.");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
