// App-wide default semester. The default is the chronologically-latest term in
// the catalog (latest_section_term RPC), so it advances on its own as new terms
// are synced — no hardcoded year. Terms only change on a manual sync, so the
// result is cached in-memory with a short TTL to avoid an RPC on every request.

import { supabase } from "./supabase.ts";

const TTL_MS = 30 * 60 * 1000; // 30 minutes

// Safety net if the RPC ever fails before we've cached a real value.
const FALLBACK_TERM = "2026FALL";

let cached: string | null = null;
let fetchedAt = 0;

export async function getDefaultTerm(): Promise<string> {
  const now = Date.now();
  if (cached && now - fetchedAt < TTL_MS) return cached;

  const { data, error } = await supabase.rpc("latest_section_term");
  if (error || typeof data !== "string" || !data) {
    if (error) console.error("Default term lookup failed:", error.message);
    return cached ?? FALLBACK_TERM;
  }

  cached = data;
  fetchedAt = now;
  return cached;
}
