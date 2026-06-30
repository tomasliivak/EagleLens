// Shared helpers for the database sync scripts (syncClasses.ts, syncEvals.ts).
//
// Holds the service-role Supabase client plus the source-agnostic helpers used
// by both halves of the sync. Requires SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in backend/.env. The service-role key bypasses RLS,
// so these scripts must only ever run from your machine.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// How many Avalanche requests to keep in flight. Avalanche is a live BC server,
// so keep this modest.
export const AVALANCHE_CONCURRENCY = 5;
export const UPSERT_CHUNK = 500;

// Optional smoke-test cap: SYNC_LIMIT=20 npm run sync:evals queries Avalanche for
// only the first N course codes.
const parsedLimit = Number.parseInt(process.env.SYNC_LIMIT ?? "", 10);
export const SYNC_LIMIT =
  Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to backend/.env."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Small generic helpers
// ---------------------------------------------------------------------------

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

export async function upsertChunked(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  ignoreDuplicates = false
): Promise<void> {
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await supabase
      .from(table)
      .upsert(part, { onConflict, ignoreDuplicates });
    if (error) {
      throw new Error(`Upsert into ${table} failed: ${error.message}`);
    }
  }
}

export async function deleteByIdsChunked(
  table: string,
  ids: number[]
): Promise<void> {
  for (const part of chunk(ids, UPSERT_CHUNK)) {
    const { error } = await supabase.from(table).delete().in("id", part);
    if (error) {
      throw new Error(`Delete from ${table} failed: ${error.message}`);
    }
  }
}

// Supabase caps a single select at 1000 rows, so page through with .range().
export async function selectAll<T>(
  table: string,
  columns: string
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Select from ${table} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Rebuild the precomputed ranking/explore cache tables from current DB state.
// Cheap and idempotent; run at the end of each sync so the cached rows reflect
// the latest catalog + evaluations.
export async function refreshCaches(): Promise<void> {
  console.log("Refreshing ranking/explore caches…");
  const { error } = await supabase.rpc("refresh_caches");
  if (error) {
    throw new Error(`refresh_caches failed: ${error.message}`);
  }
}

// Upsert every name, then read the full table back to map name -> id.
export async function upsertInstructorsAndMap(
  names: Iterable<string>
): Promise<Map<string, number>> {
  const rows = [...new Set(names)].map((canonical_name) => ({ canonical_name }));
  await upsertChunked("instructors", rows, "canonical_name", true);

  const map = new Map<string, number>();
  const all = await selectAll<{ id: number; canonical_name: string }>(
    "instructors",
    "id,canonical_name"
  );
  for (const row of all) map.set(row.canonical_name, row.id);
  return map;
}
