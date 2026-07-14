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

# Project Context: PlanUrBC

A **Boston College course-planning web app**. Students browse courses, see professor/section ratings sourced from BC's evaluation system, and explore courses by core requirement, school, department, and workload. (The app is named "PlanUrBC" in the UI; some code/README strings say "PlanYourBC" — same project.)

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

**`npm run sync`** (`backend/scripts/syncDatabase.ts`) end-to-end: load BC catalog → upsert `departments / core_requirements / courses / course_core_requirements / instructors / sections / section_instructors` → query Avalanche summaries (concurrency-limited) → drilldown backfill once per course+instructor pair → upsert `evaluations`. Requires `SUPABASE_URL` + **`SUPABASE_SERVICE_ROLE_KEY`** (bypasses RLS). Set `SYNC_LIMIT=N` to cap Avalanche queries when testing.

## Database

Tables: `departments`, `core_requirements`, `courses`, `course_core_requirements`, `instructors`, `sections`, `section_instructors`, `evaluations`. Aggregation **views** (all `security_invoker`): `instructor_ratings` (a prof's global average), `instructor_course_ratings` (a prof in one course), `course_ratings` (a course across all profs). RLS = public read on every table.

**RPC functions** (defined in migrations, called via `supabase.rpc(...)`): `get_course_instructors`, `get_course_professors`, `explore_courses`, `list_section_terms`.

Notable column facts:
- `core_requirements`: the human-readable label is the **`code`** column (e.g. `Arts`, `Social Science`, `Theology`); **`name` is null**.
- `sections`: has `term`, `credits`, `college` (BC college code), `meeting_text` (packs `"<Building Room> <Days> <Time>"`, e.g. `"Fulton Hall 423 WF 11:00AM-11:50AM"`).

## Backend API (`backend/src/`)

- Health: `GET /api/health`, `GET /api/hello`.
- **Courses** (`controllers/coursesController.ts`, `routes/coursesRoutes.ts`): `GET /api/courses/search?q=`, `/explore?term=&college=&department=&core=&minReviews=&maxWorkload=`, `/filters`, `/:courseCode?term=`, `/:courseCode/professors?term=`. **Route order matters**: `/search`, `/explore`, `/filters` are registered **before** `/:courseCode` so the param route doesn't shadow them.
- **Evaluations** (`/api/evaluations/summary?query=`, `/api/evaluations/drilldown?...`): these hit **Avalanche live**, not the DB.
- Backend Supabase client (`backend/src/lib/supabase.ts`) prefers the **anon** key for API reads (falls back to service-role only if that's all that's configured).

## Frontend routes / pages

Real: `/` `HomePage`, `/explore` `ExplorePage`, `/courses/:courseCode` `CoursePage`. Placeholders ("Coming soon"): `/rankings`, `/my-plan`, and footer pages (`/privacy`, `/terms`, `/contact`, `/about` via `PlaceholderPage`). All wrapped in `components/Layout.tsx` (Navbar + Footer). `SearchBar` is debounced and calls `/api/courses/search`. Reusable CSS classes: `.metric*`, `.sort*`, `.tag`, `.pill`, `.container--fluid`, `.stat-box*`.

## Auth & user data (data structures only — no UI yet)

Supabase Auth with **Google OAuth restricted to @bc.edu** (email provider disabled). Enforcement is server-side: an `after insert` trigger on `auth.users` (`enforce_bc_email`, migration 0024) rejects non-BC signups, and every write RLS policy also checks `is_bc_email()`. The frontend `hd: 'bc.edu'` query param is a hint only.

Tables (migration `0024_auth_reviews_saved_courses.sql`):
- `reviews` — `user_id` (nullable, FK `auth.users`), `course_code`, `instructor_id`, `would_recommend boolean`, `comment`, `source` (`'user'` | `'rmp'`). Public read; insert/update/delete only by the owner (`auth.uid()`). Unique `(user_id, course_code, instructor_id)`. **`user_id is null` rows are imported RateMyProfessors reviews** — inserted only via the service-role key; a check constraint stops signed-in users from forging `source = 'rmp'`.
- `saved_courses` — PK `(user_id, course_code)`. **Fully private**: owner-only select/insert/delete (do NOT copy the public-read RLS pattern here).

Frontend plumbing: `src/lib/supabase.ts` (browser client from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`), `src/lib/auth.tsx` (`AuthProvider` / `useAuth`), navbar user icon (sign-in when signed out, links to `/account` when signed in), blank `AccountPage` at `/account`. User data (reviews/saved) goes **frontend → Supabase directly** (RLS is the boundary); the Express backend is untouched and only serves catalog reads.

**Not built yet:** any UI for creating/showing reviews, saving classes, or the saved-classes list; the RMP import script. Only the schema, RLS, and sign-in flow exist.

## Conventions & gotchas

- **Default term is `2026FALL`** (data currently holds `2026FALL` and `2026SUMM`).
- **Workload (`effort_avg_hours_weekly`) is a 1–5 rating, NOT literal hours.** Render it as Light/Moderate/Heavy via `workloadLabel` (thresholds: `>=3.5` Heavy, `>=2.3` Moderate, else Light). Never display it as "hrs/week".
- **Course & explore aggregates average per *unique instructor* of the term**, not per section, so a prof teaching many sections doesn't dominate the numbers.
- **0-credit sections are excluded** (`credits <> 0`) from the course/explore RPCs — they're labs/discussions with no standalone rating.
- PostgREST caps plain table selects at ~1000 rows, so a `select` for distinct facets silently misses values — use a dedicated RPC instead (e.g. `list_section_terms` for the semester list).
- Numeric columns come back from PostgREST/`supabase-js` as **strings**; convert with the `num()` helper in the controller. Bigint counts can also arrive as strings (`Number(...)` them).
- **Never commit `backend/.env`** — the service-role key is local-only and must never reach the browser.
- The UI rates "evals" (evaluations), e.g. the Explore page shows "N evals"; the underlying field is `reviewCount` / `evaluation_count`.