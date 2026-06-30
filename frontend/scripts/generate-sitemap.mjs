// Build-time sitemap generator for Eagle Lens.
// Emits frontend/public/sitemap.xml: the fixed routes plus every course, professor,
// and department page, enumerated from Supabase via the same rank_* RPCs that power
// the on-site ranking pages. Runs as the frontend `prebuild` step so each deploy ships
// a current sitemap. If Supabase env/credentials are missing it degrades to a valid
// static-only sitemap rather than failing the build.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SITE_URL = (process.env.SITE_URL || "https://eaglelens.org").replace(/\/+$/, "");
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://jziyrjavclicsjbealml.supabase.co").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Static, content-rich routes (placeholders like /privacy are intentionally excluded).
const STATIC_PATHS = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/explore", priority: "0.9", changefreq: "daily" },
  { path: "/rankings/classes", priority: "0.8", changefreq: "weekly" },
  { path: "/rankings/professors", priority: "0.8", changefreq: "weekly" },
  { path: "/rankings/departments", priority: "0.8", changefreq: "weekly" },
  { path: "/rankings/schools", priority: "0.8", changefreq: "weekly" },
];

// Schools are a fixed set of BC college codes (no DB query needed).
const SCHOOL_CODES = ["MCAS", "CSOM", "CSON", "LSOE", "LAW", "STM", "SSW", "MCBC"];

const PAGE_SIZE = 1000;

// Page through a rank_* RPC and collect one id field per row.
async function fetchIds(fn, idField) {
  const ids = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_metric: "rating",
        p_order: "desc",
        p_min_evals: 0,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      }),
    });
    if (!res.ok) {
      throw new Error(`${fn} -> HTTP ${res.status} ${await res.text()}`);
    }
    const rows = await res.json();
    for (const row of rows) {
      if (row[idField] !== null && row[idField] !== undefined) ids.push(String(row[idField]));
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return ids;
}

function urlEntry(path, { priority, changefreq, lastmod }) {
  const loc = `${SITE_URL}${path}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const parts = [`    <loc>${loc}</loc>`, `    <lastmod>${lastmod}</lastmod>`];
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

async function main() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const entries = STATIC_PATHS.map((s) => urlEntry(s.path, { ...s, lastmod }));

  for (const code of SCHOOL_CODES) {
    entries.push(urlEntry(`/schools/${encodeURIComponent(code)}`, { priority: "0.6", changefreq: "weekly", lastmod }));
  }

  if (!SUPABASE_KEY) {
    console.warn("[sitemap] No SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY set — writing static-only sitemap.");
  } else {
    try {
      const [courses, professors, departments] = await Promise.all([
        fetchIds("rank_classes", "course_code"),
        fetchIds("rank_professors", "instructor_id"),
        fetchIds("rank_departments", "department_code"),
      ]);
      for (const code of courses) {
        entries.push(urlEntry(`/courses/${encodeURIComponent(code)}`, { priority: "0.7", changefreq: "weekly", lastmod }));
      }
      for (const id of professors) {
        entries.push(urlEntry(`/professors/${encodeURIComponent(id)}`, { priority: "0.6", changefreq: "weekly", lastmod }));
      }
      for (const code of departments) {
        entries.push(urlEntry(`/departments/${encodeURIComponent(code)}`, { priority: "0.6", changefreq: "weekly", lastmod }));
      }
      console.log(`[sitemap] Enumerated ${courses.length} courses, ${professors.length} professors, ${departments.length} departments.`);
    } catch (err) {
      console.warn(`[sitemap] Dynamic enumeration failed (${err.message}) — writing static-only sitemap.`);
    }
  }

  if (entries.length > 50000) {
    console.warn(`[sitemap] ${entries.length} URLs exceeds the 50,000-per-file limit; consider a sitemap index.`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

  const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sitemap.xml");
  writeFileSync(outPath, xml);
  console.log(`[sitemap] Wrote ${entries.length} URLs to ${outPath}`);
}

main().catch((err) => {
  console.error("[sitemap] Generation failed:", err);
  process.exit(1);
});
