# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project Context: Eagle Lens

A **Boston College course-planning web app**, live at https://eaglelens.org. Students browse courses, see professor/section ratings sourced from BC's evaluation system, and explore courses by core requirement, school, department, and workload.

## Stack & layout

Monorepo via **npm workspaces** (root `package.json`, `workspaces: [frontend, backend]`):

- **`frontend/`** — React 18 + Vite + TypeScript + react-router. Dev server on **port 5173**. Global styles in `src/index.css` (maroon BC theme via CSS vars). Routing in `src/App.tsx`.
- **`backend/`** — Express + TypeScript, run with `tsx`. Listens on **port 3000** (`src/index.ts`, `PORT` env override).
- **`supabase/migrations/`** — numbered SQL migrations (schema, views, RPC functions).
- **Datastore** — Supabase Postgres, project ref `jziyrjavclicsjbealml` (see `.mcp.json`; the Supabase MCP tools operate on this project — use `apply_migration` for DDL and keep the matching file in `supabase/migrations/` in sync).

## Run / dev

```bash
npm install            # at repo root (installs both workspaces)
npm run dev            # runs frontend + backend together (concurrently)
npm run dev:frontend   # Vite only  -> http://localhost:5173
npm run dev:backend    # Express only -> http://localhost:3000
npm run build          # builds both
```

Vite proxies `/api/*` → `http://localhost:3000` (`frontend/vite.config.ts`), so the frontend calls `fetch('/api/...')` with no CORS issues locally.

## Two data sources + the sync pipeline

The DB is the **union** of two feeds, stitched on `(course_code, canonical instructor name)`:

1. **BC course feed** (live catalog) — `backend/src/fetchCourses.ts` pulls three public JSON feeds (`https://bcweb.bc.edu/aem/courses{fall,summ,sprg}.json`); shaped in `normalizeCourses.ts`. Authoritative for course/section/department metadata.
2. **Avalanche** (`avalanche.bc.edu`) — BC's internal evaluations system. `backend/src/services/avalancheService.ts` scrapes it (POST → HTML table → parsed with Cheerio) for summary ratings and drilldown metrics.

**Stitching:** instructor names are canonicalized to `"First Last"` by `backend/src/lib/instructorName.ts` (`standardizeInstructorName`, `parseBCInstructors`), so BC's `"Last, First"` and Avalanche's `"First Last"` match deterministically. Placeholder "instructors" (Department, TA, etc.) are filtered out.

**Sync scripts** live in `backend/scripts/` and share helpers from `syncShared.ts`. All require `SUPABASE_URL` + **`SUPABASE_SERVICE_ROLE_KEY`** (bypasses RLS) and are run manually from the `backend` workspace:
- **`npm run sync:classes`** (`syncClasses.ts`) — load BC catalog → upsert `departments / core_requirements / courses / course_core_requirements / instructors / sections / section_instructors` → `refreshCaches()`. Minutes.
- **`npm run sync:evals`** (`syncEvals.ts`) — reads course codes **from the DB**, so it must run *after* `sync:classes`. Queries Avalanche summaries (concurrency capped at 5) → drilldown backfill once per course+instructor pair → upsert `evaluations`. Tens of minutes. `SYNC_LIMIT=N` caps phase 1 when testing.
- **`npm run sync`** — `sync:classes && sync:evals`.
- **`npm run sync:rmp`** (`fetchRateMyProf.ts`) — optional RateMyProfessors import (full refresh; `RMP_LIMIT=N`, `RMP_DELAY_MS`, default 1000ms).

There is **no** `syncDatabase.ts` — it was split into the scripts above.

## Database

Tables: `departments`, `core_requirements`, `courses`, `course_core_requirements`, `instructors`, `sections`, `section_instructors`, `evaluations`. Aggregation **views** (all `security_invoker`): `instructor_ratings` (a prof's global average), `instructor_course_ratings` (a prof in one course), `course_ratings` (a course across all profs). RLS = public read on every table.

**RPC functions** (defined in migrations, called via `supabase.rpc(...)`): course/explore — `get_course_instructors`, `get_course_professors`, `explore_courses`, `list_section_terms`, `latest_section_term`; entity pages — `get_professor`, `get_professor_courses`, `get_professor_sections`, `get_department`, `get_school`; rankings — `rank_classes`, `rank_professors`, `rank_departments`, `rank_schools`, `rank_department_professors`, `rank_school_professors`; review forms — `get_course_review_professors`, `get_professor_review_courses`. Migration `0018_precomputed_caches.sql` also defines `refresh_caches`, called at the end of `sync:classes`.

Notable column facts:
- `core_requirements`: the human-readable label is the **`code`** column (e.g. `Arts`, `Social Science`, `Theology`); **`name` is null**.
- `sections`: has `term`, `credits`, `college` (BC college code), `meeting_text` (packs `"<Building Room> <Days> <Time>"`, e.g. `"Fulton Hall 423 WF 11:00AM-11:50AM"`).

## Backend API (`backend/src/`)

All routers are mounted in `src/index.ts` behind `apiLimiter` (`middleware/rateLimit.ts`, in-memory so per-instance).

- Health: `GET /api/health`, `GET /api/hello` (the latter is an unused demo route).
- **Courses** (`/api/courses`): `/search?q=`, `/explore?term=&college=&department=&core=&minReviews=&maxWorkload=`, `/filters`, `/by-codes`, `/:courseCode?term=`, `/:courseCode/professors?term=`, `/:courseCode/review-professors`. **Route order matters**: the literal paths are registered **before** `/:courseCode` so the param route doesn't shadow them. `/by-codes` is currently unused by the frontend (it fed the shelved saved-courses UI).
- **Rankings** (`/api/rankings/:entity`) — `classes | professors | departments | schools`, mapped to the `rank_*` RPCs.
- **Search** (`/api/search`), **Professors** (`/api/professors/:id`, `/:id/review-courses`), **Departments** (`/api/departments/:code`), **Schools** (`/api/schools/:code`).
- There is **no** `/api/evaluations` router — it was removed as unused. Avalanche is now only reached from the sync scripts, never at request time.
- Backend Supabase client (`backend/src/lib/supabase.ts`) prefers the **anon** key for API reads (falls back to service-role only if that's all that's configured).

## Frontend routes / pages

Real: `/` `HomePage`, `/explore` `ExplorePage`, `/courses/:courseCode` `CoursePage`, `/courses/:courseCode/review` + `/professors/:id/review` `ReviewPage`, `/professors/:id` `ProfessorPage`, `/departments/:code` `DepartmentPage`, `/schools/:code` `SchoolPage`, `/rankings/:entity` `RankingsPage` (`/rankings` redirects to `/rankings/classes`; entities are `classes | professors | departments | schools`), `/account` `AccountPage`, `/privacy` `PrivacyPage`, `/terms` `TermsPage`, `*` `ErrorPage`. Placeholders ("Coming soon" via `PlaceholderPage`): **only** `/contact` and `/about`. There is no `/my-plan` route. All wrapped in `components/Layout.tsx` (Navbar + Footer). `SearchBar` is debounced and calls `/api/courses/search`. Reusable CSS classes: `.metric*`, `.sort*`, `.tag`, `.pill`, `.container--fluid`, `.stat-box*`.

The frontend build also runs `prebuild` (`scripts/generate-sitemap.mjs`) and `postbuild` (`scripts/prerender.mjs`), which read Supabase directly via plain (non-`VITE_`) env vars and degrade to a no-op when credentials are absent.

## Auth & user data

Supabase Auth with **Google OAuth restricted to @bc.edu** (email provider disabled). Enforcement is server-side: an `after insert` trigger on `auth.users` (`enforce_bc_email`, migration 0024) rejects non-BC signups, and every write RLS policy also checks `is_bc_email()`. The frontend `hd: 'bc.edu'` query param is a hint only.

Tables (migration `0024_auth_reviews_saved_courses.sql`):
- `reviews` — `user_id` (nullable, FK `auth.users`), `course_code`, `instructor_id`, `would_recommend boolean`, `comment`, `source` (`'user'` | `'rmp'`). Public read; insert/update/delete only by the owner (`auth.uid()`). Unique `(user_id, course_code, instructor_id)`. **`user_id is null` rows are imported RateMyProfessors reviews** — inserted only via the service-role key; a check constraint stops signed-in users from forging `source = 'rmp'`.
- `saved_courses` — PK `(user_id, course_code)`. **Fully private**: owner-only select/insert/delete (do NOT copy the public-read RLS pattern here).

Frontend plumbing: `src/lib/supabase.ts` (browser client from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`), `src/lib/auth.tsx` (`AuthProvider` / `useAuth`), navbar user icon (links to `/account`). User data (reviews) goes **frontend → Supabase directly** (RLS is the boundary); the Express backend is untouched and only serves catalog reads.

**Shipped:** `ReviewPage` (write a review — recommend toggle + 20–500 char comment, duplicate handled on PG code `23505`), review display on course/professor pages, `AccountPage` "My Reviews" with inline edit/delete, and the RMP import script (`npm run sync:rmp -w backend`).

**Not built yet:** saved courses. The `saved_courses` table and RLS exist, but there is no "save a course" button anywhere, and the `AccountPage` section for it is commented out (`AccountPage.tsx:5-12`). The backend `/api/courses/by-codes` route that fed it is currently unused.

## Conventions & gotchas

- **Default term is `2026FALL`** (data currently holds `2026FALL` and `2026SUMM`).
- **Workload (`effort_avg_hours_weekly`) is a 1–5 rating, NOT literal hours.** Render it as Light/Moderate/Heavy via `workloadLabel` (thresholds: `>=3.5` Heavy, `>=2.3` Moderate, else Light). Never display it as "hrs/week".
- **Course & explore aggregates average per *unique instructor* of the term**, not per section, so a prof teaching many sections doesn't dominate the numbers.
- **0-credit sections are excluded** (`credits <> 0`) from the course/explore RPCs — they're labs/discussions with no standalone rating.
- PostgREST caps plain table selects at ~1000 rows, so a `select` for distinct facets silently misses values — use a dedicated RPC instead (e.g. `list_section_terms` for the semester list).
- Numeric columns come back from PostgREST/`supabase-js` as **strings**; convert with the `num()` helper in the controller. Bigint counts can also arrive as strings (`Number(...)` them).
- **Never commit `backend/.env`** — the service-role key is local-only and must never reach the browser.
- The UI rates "evals" (evaluations), e.g. the Explore page shows "N evals"; the underlying field is `reviewCount` / `evaluation_count`.