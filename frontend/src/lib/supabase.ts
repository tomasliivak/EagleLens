import { createClient } from '@supabase/supabase-js'

// Frontend talks to Supabase directly for auth + user data (reviews, saved
// courses) — RLS is the security boundary. Catalog data still goes through
// the Express API.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
