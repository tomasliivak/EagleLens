// Build-time sitemap generator for Eagle Lens.
// Emits frontend/public/sitemap.xml: the fixed routes plus every course, professor,
// and department page, enumerated from Supabase via the same rank_* RPCs that power
// the on-site ranking pages. Runs as the frontend `prebuild` step so each deploy ships
// a current sitemap. If Supabase env/credentials are missing it degrades to a valid
// static-only sitemap rather than failing the build.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE_URL, SUPABASE_KEY, SCHOOL_CODES, fetchRankRows } from "./lib/rankData.mjs";

// Static, content-rich routes (placeholders like /privacy are intentionally excluded).
const STATIC_PATHS = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/explore", priority: "0.9", changefreq: "daily" },
  { path: "/rankings/classes", priority: "0.8", changefreq: "weekly" },
  { path: "/rankings/professors", priority: "0.8", changefreq: "weekly" },
  { path: "/rankings/departments", priority: "0.8", changefreq: "weekly" },
  { path: "/rankings/schools", priority: "0.8", changefreq: "weekly" },
];

// Collect one id field per row from a rank_* RPC.
async function fetchIds(fn, idField) {
  const rows = await fetchRankRows(fn);
  return rows
    .filter((row) => row[idField] !== null && row[idField] !== undefined)
    .map((row) => String(row[idField]));
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
