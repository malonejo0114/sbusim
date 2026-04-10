import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv, requireEnv } from "@/server/env";

let _admin: SupabaseClient | null = null;

export function hasSupabaseConfig() {
  return Boolean(optionalEnv("SUPABASE_URL") && optionalEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export function getSupabaseAdminClient() {
  if (_admin) return _admin;

  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  _admin = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _admin;
}
