// Build-time static prerendering for Eagle Lens course & professor detail pages.
// Runs as the frontend `postbuild` step, after `vite build` has produced dist/index.html
// (with the hashed bundle reference). For every course (/courses/:courseCode) and professor
// (/professors/:id) it writes dist/<route>/index.html: the same shell, but with a route-specific
// <title>, meta description, canonical URL, Open Graph/Twitter tags, and crawler-visible content
// injected into #root. The app's createRoot() render replaces that stub on mount, so the page
// still loads the existing bundle and renders normally in the browser.
//
// Data comes from the same rank_* RPCs the sitemap uses — those rows already carry the title/name,
// department, rating, difficulty, workload, and review count, so no per-route API call is needed.
// If Supabase credentials are missing (or the fetch fails) it warns and exits 0: the plain SPA
// build stays valid and unknown routes fall back to index.html via the Vercel rewrite.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE_URL, SUPABASE_KEY, COLLEGE_LABELS, SCHOOL_CODES, fetchRankRows } from "./lib/rankData.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const OG_IMAGE = `${SITE_URL}/redeagleeye.png`;

const collegeLabel = (code) => (code == null ? null : COLLEGE_LABELS[code] ?? code);

const escHtml = (v) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const escAttr = (v) => escHtml(v).replace(/"/g, "&quot;");

const fmt = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(1));

// Mirrors frontend/src/lib/difficulty.ts (data-derived terciles, higher = harder).
const difficultyLabel = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || Number.isNaN(n)) return "—";
  if (n >= 4.5) return "Hard";
  if (n >= 4.25) return "Moderate";
  return "Easy";
};

// Mirrors workloadLabel in CoursePage.tsx (1–5 rating, not literal hours).
const workloadLabel = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || Number.isNaN(n)) return "—";
  if (n >= 3.5) return "Heavy";
  if (n >= 2.3) return "Moderate";
  return "Light";
};

// Only alphanumerics, dot, underscore, hyphen are safe as a path segment served at the same URL.
const safeSegment = (seg) => /^[A-Za-z0-9._-]+$/.test(seg);

// Build a full HTML document from the shell by injecting head tags and #root content.
function renderPage(template, { title, description, canonical, bodyHtml }) {
  const head = [
    `<link rel="canonical" href="${escAttr(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Eagle Lens" />`,
    `<meta property="og:title" content="${escAttr(title)}" />`,
    `<meta property="og:description" content="${escAttr(description)}" />`,
    `<meta property="og:url" content="${escAttr(canonical)}" />`,
    `<meta property="og:image" content="${escAttr(OG_IMAGE)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escAttr(title)}" />`,
    `<meta name="twitter:description" content="${escAttr(description)}" />`,
    `<meta name="twitter:image" content="${escAttr(OG_IMAGE)}" />`,
  ].join("\n    ");

  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/, `<meta name="description" content="${escAttr(description)}" />`)
    .replace("</head>", `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
}

function writePage(routeDir, html) {
  const dir = join(DIST, routeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

function coursePage(template, row) {
  const code = String(row.course_code);
  const title = row.title ? `${row.title} (${code})` : code;
  const dept = row.department_name || "Boston College";
  const canonical = `${SITE_URL}/courses/${code}`;
  const description =
    `See professor ratings, difficulty, and workload for ${title} at Boston College. ` +
    `Average rating ${fmt(row.rating)}/5, difficulty ${difficultyLabel(row.difficulty)}, ` +
    `workload ${workloadLabel(row.workload)}, from ${Number(row.review_count) || 0} student evaluations.`;
  const bodyHtml =
    `<main class="prerender">` +
    `<p>${escHtml(code)} &middot; ${escHtml(dept)}</p>` +
    `<h1>${escHtml(row.title || code)}</h1>` +
    `<p>Average rating ${escHtml(fmt(row.rating))}/5 &middot; Difficulty ${escHtml(difficultyLabel(row.difficulty))} ` +
    `&middot; Workload ${escHtml(workloadLabel(row.workload))} &middot; ${Number(row.review_count) || 0} evaluations ` +
    `at Boston College.</p>` +
    `</main>`;
  return renderPage(template, { title: `${title} — BC Course Ratings | Eagle Lens`, description, canonical, bodyHtml });
}

function professorPage(template, row) {
  const id = String(row.instructor_id);
  const name = row.name || `Professor ${id}`;
  const dept = row.department_name || "Boston College";
  const canonical = `${SITE_URL}/professors/${id}`;
  const description =
    `Student ratings for ${name}, ${dept} at Boston College — overall ${fmt(row.rating)}/5, ` +
    `difficulty ${difficultyLabel(row.difficulty)}, workload ${workloadLabel(row.workload)}, ` +
    `based on ${Number(row.review_count) || 0} evaluations.`;
  const bodyHtml =
    `<main class="prerender">` +
    `<p>Professor &middot; ${escHtml(dept)}</p>` +
    `<h1>${escHtml(name)}</h1>` +
    `<p>Overall rating ${escHtml(fmt(row.rating))}/5 &middot; Difficulty ${escHtml(difficultyLabel(row.difficulty))} ` +
    `&middot; Workload ${escHtml(workloadLabel(row.workload))} &middot; Based on ${Number(row.review_count) || 0} ` +
    `student evaluations at Boston College.</p>` +
    `</main>`;
  return renderPage(template, { title: `${name} — BC Professor Ratings | Eagle Lens`, description, canonical, bodyHtml });
}

function departmentPage(template, row) {
  const code = String(row.department_code);
  const name = row.name || code;
  const school = collegeLabel(row.college) || "Boston College";
  const canonical = `${SITE_URL}/departments/${code}`;
  const description =
    `Course and professor ratings for the ${name} department (${school}) at Boston College — ` +
    `average rating ${fmt(row.rating)}/5, difficulty ${difficultyLabel(row.difficulty)}, ` +
    `workload ${workloadLabel(row.workload)}, across ${Number(row.review_count) || 0} evaluations.`;
  const bodyHtml =
    `<main class="prerender">` +
    `<p>Department &middot; ${escHtml(school)}</p>` +
    `<h1>${escHtml(name)}</h1>` +
    `<p>Average rating ${escHtml(fmt(row.rating))}/5 &middot; Difficulty ${escHtml(difficultyLabel(row.difficulty))} ` +
    `&middot; Workload ${escHtml(workloadLabel(row.workload))} &middot; ${Number(row.review_count) || 0} evaluations ` +
    `at Boston College.</p>` +
    `</main>`;
  return renderPage(template, { title: `${name} Department — BC Course Ratings | Eagle Lens`, description, canonical, bodyHtml });
}

// Schools are the fixed COLLEGE_LABELS set; `row` is the matching rank_schools row (metrics) or
// undefined when a school has no rated evaluations yet.
function schoolPage(template, code, row) {
  const name = collegeLabel(code);
  const canonical = `${SITE_URL}/schools/${code}`;
  const r = row || {};
  const description =
    `Explore course and professor ratings across ${name} at Boston College — ` +
    `average rating ${fmt(r.rating)}/5, difficulty ${difficultyLabel(r.difficulty)}, ` +
    `workload ${workloadLabel(r.workload)}, from ${Number(r.review_count) || 0} evaluations.`;
  const bodyHtml =
    `<main class="prerender">` +
    `<p>Boston College</p>` +
    `<h1>${escHtml(name)}</h1>` +
    `<p>Average rating ${escHtml(fmt(r.rating))}/5 &middot; Difficulty ${escHtml(difficultyLabel(r.difficulty))} ` +
    `&middot; Workload ${escHtml(workloadLabel(r.workload))} &middot; ${Number(r.review_count) || 0} evaluations ` +
    `at Boston College.</p>` +
    `</main>`;
  return renderPage(template, { title: `${name} — BC Course & Professor Ratings | Eagle Lens`, description, canonical, bodyHtml });
}

async function main() {
  if (!SUPABASE_KEY) {
    console.warn("[prerender] No SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY set — skipping prerender (SPA build only).");
    return;
  }

  let template;
  try {
    template = readFileSync(join(DIST, "index.html"), "utf8");
  } catch (err) {
    console.warn(`[prerender] Could not read dist/index.html (${err.message}) — skipping prerender.`);
    return;
  }

  let courses, professors, departments, schools;
  try {
    [courses, professors, departments, schools] = await Promise.all([
      fetchRankRows("rank_classes"),
      fetchRankRows("rank_professors"),
      fetchRankRows("rank_departments"),
      fetchRankRows("rank_schools"),
    ]);
  } catch (err) {
    console.warn(`[prerender] Data fetch failed (${err.message}) — skipping prerender (SPA build only).`);
    return;
  }

  let courseCount = 0;
  let skipped = 0;
  for (const row of courses) {
    const code = row.course_code == null ? "" : String(row.course_code);
    if (!safeSegment(code)) {
      skipped++;
      continue;
    }
    writePage(join("courses", code), coursePage(template, row));
    courseCount++;
  }

  let profCount = 0;
  for (const row of professors) {
    const id = row.instructor_id == null ? "" : String(row.instructor_id);
    if (!safeSegment(id)) {
      skipped++;
      continue;
    }
    writePage(join("professors", id), professorPage(template, row));
    profCount++;
  }

  let deptCount = 0;
  for (const row of departments) {
    const code = row.department_code == null ? "" : String(row.department_code);
    if (!safeSegment(code)) {
      skipped++;
      continue;
    }
    writePage(join("departments", code), departmentPage(template, row));
    deptCount++;
  }

  // Schools: the fixed COLLEGE_LABELS set (matches the sitemap), enriched with rank_schools metrics.
  const schoolByCode = new Map(schools.map((row) => [String(row.college), row]));
  let schoolCount = 0;
  for (const code of SCHOOL_CODES) {
    writePage(join("schools", code), schoolPage(template, code, schoolByCode.get(code)));
    schoolCount++;
  }

  console.log(
    `[prerender] Wrote ${courseCount} course + ${profCount} professor + ${deptCount} department + ` +
      `${schoolCount} school pages to dist/` +
      (skipped ? ` (skipped ${skipped} with unsafe path segments).` : ".")
  );
}

main().catch((err) => {
  // Never fail the build over prerendering — the SPA remains fully functional.
  console.warn(`[prerender] Unexpected error (${err.message}) — skipping prerender.`);
});
