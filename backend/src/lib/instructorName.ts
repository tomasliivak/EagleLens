// src/lib/instructorName.ts
//
// Shared instructor-name normalization so the two data sources we sync
// (BC course listings and Avalanche evaluations) agree on one canonical
// "First Last" format.
//
//   BC courses  -> "Last, First Middle"   e.g. "Goldman, Alyssa W"
//   Avalanche   -> "First Last"           e.g. "Alyssa Goldman"
//   Canonical   -> "First Last"           e.g. "Alyssa Goldman"
//
// The point of routing BOTH sources through standardizeInstructorName is that
// matching depends on the transform being identical, not on it being
// "correct" by human standards. As long as both sides collapse casing the
// same way (e.g. "DiDonato" -> "Didonato", "McGuffey" -> "Mcguffey"), the two
// sources line up.

/**
 * Returns true for placeholder/role values that aren't real instructors.
 * Examples seen in BC data: "Dept", "Dept, Dept", "Department",
 * "Dept assigned", "The departmentt", "Ta", "Tf", "Pt", "Pd", "Temporary",
 * "Planning section, Do not use for registration".
 */
export function isPlaceholderInstructor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  if (/depart/.test(v) || /\bdept\b/.test(v)) return true;
  if (/do not use for registration|planning section/.test(v)) return true;
  if (["ta", "tf", "pt", "pd", "temporary"].includes(v)) return true;
  return false;
}

/**
 * Capitalizes the first letter of a single name token and lowercases the rest,
 * treating hyphens as word boundaries (so "bargain-darrigues" ->
 * "Bargain-Darrigues"). Apostrophes are not treated as boundaries, matching
 * Avalanche's rendering (so "O'Brien" -> "O'brien").
 */
function capitalizeNameToken(token: string): string {
  return token
    .split("-")
    .map((segment) =>
      segment ? segment[0].toUpperCase() + segment.slice(1).toLowerCase() : segment
    )
    .join("-");
}

/**
 * Canonical form for any "First Last" name: collapse whitespace and apply
 * consistent capitalization. This is the single source of truth for casing
 * and is applied to BOTH data sources.
 */
export function standardizeInstructorName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizeNameToken)
    .join(" ");
}

/**
 * Converts one BC-formatted entry ("Last, First Middle...") into the canonical
 * "First Last" form, dropping any middle names/initials. Returns null for
 * placeholders or anything we can't confidently parse into a name.
 */
export function bcEntryToCanonicalName(entry: string): string | null {
  if (isPlaceholderInstructor(entry)) return null;

  const commaIndex = entry.indexOf(",");

  // No comma: BC's "Last, First" shape is absent, so we can't split reliably.
  // Real names in the feed always include the comma; anything here is fringe,
  // so just standardize what's given.
  if (commaIndex === -1) {
    const standardized = standardizeInstructorName(entry);
    return standardized || null;
  }

  // Split on commas, not just the first one: BC packs a suffix into a third
  // field ("Mc Gowan, Richard, SJ"), and slicing past the first comma would
  // glue it onto the first name as "Richard,".
  const parts = entry.split(",");
  const last = parts[0].trim();
  const first = (parts[1] ?? "").trim().split(/\s+/)[0] ?? "";

  if (!last || !first) return null;

  return standardizeInstructorName(`${first} ${last}`);
}

// One or two name tokens — letters plus the punctuation real names carry.
// Two allows multi-word surnames like "Mc Gowan" and "Van Dyke".
const NAME_SIDE = /^\p{L}[\p{L}'’.-]*(?: \p{L}[\p{L}'’.-]*)?$/u;

/**
 * If a search query looks like a single "Last, First" name, returns it in the
 * canonical "First Last" form for matching against instructors.canonical_name.
 * Returns null for anything else — several commas, digits, or long fragments
 * are ordinary search text (course titles carry commas too), not names.
 */
export function lastFirstQueryToCanonicalName(query: string): string | null {
  const parts = query.split(",");
  if (parts.length !== 2) return null;

  const [last, first] = parts.map((p) => p.trim());
  if (!NAME_SIDE.test(last) || !NAME_SIDE.test(first)) return null;

  return bcEntryToCanonicalName(query);
}

/**
 * Parses a raw BC `instructors` field into canonical names. BC may pack
 * multiple instructors into one string separated by ";"
 * (e.g. "Clavin, John C;Doyle, Jeremiah T"). Placeholders are filtered out and
 * duplicates removed, preserving order.
 */
export function parseBCInstructors(raw: string | null): string[] {
  if (!raw) return [];

  const names = raw
    .split(";")
    .map(bcEntryToCanonicalName)
    .filter((name): name is string => name !== null);

  return [...new Set(names)];
}
