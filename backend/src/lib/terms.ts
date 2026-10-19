// App-wide default semester. The default is the chronologically-latest term in
// the catalog (latest_section_term RPC), so it advances on its own as new terms
// are synced — no hardcoded year. Not cached: a cached value went stale after a
// sync and disagreed with the (uncached) /filters term list, so the Explore page
// showed the old term while the new one was selected.

import { supabase } from "./supabase.ts";

// Safety net if the RPC fails.
const FALLBACK_TERM = "2026FALL";

export async function getDefaultTerm(): Promise<string> {
  const { data, error } = await supabase.rpc("latest_section_term");
  if (error || typeof data !== "string" || !data) {
    if (error) console.error("Default term lookup failed:", error.message);
    return FALLBACK_TERM;
  }
  return data;
}
