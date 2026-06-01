// Shared Supabase client for the API. Reads are public (RLS allows select),
// so this prefers the anon key and falls back to the service-role key if that's
// the only one configured locally.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing SUPABASE_URL or a Supabase key (SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) in backend/.env."
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
