# PlanYourBC

A monorepo containing a React/TypeScript frontend and an Express/TypeScript backend, managed with npm workspaces.

## Structure

```
.
├── frontend/   # React + TypeScript (Vite)
└── backend/    # Express + TypeScript
```

## Getting started

Install all dependencies from the repo root:

```bash
npm install
```

## Development

Run both apps together:

```bash
npm run dev
```

Or run them individually:

```bash
npm run dev:frontend   # Vite dev server (http://localhost:5173)
npm run dev:backend    # Express server (http://localhost:3000)
```

## Build

```bash
npm run build
```

## Deployment

The frontend (Vercel) and backend (Render) deploy as two separate services on
different origins. The frontend reaches the API via `VITE_API_BASE_URL`, and the
backend restricts CORS to the frontend origin via `ALLOWED_ORIGINS`.

Deploy in this order so each side knows the other's URL:

### 1. Backend → Render

- **Root Directory:** `backend`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run start` (runs `node dist/index.js`)
- **Environment variables:**
  - `SUPABASE_URL` — your Supabase project URL
  - `SUPABASE_ANON_KEY` — the anon key (RLS is public-read, so this is all the API needs)
  - `ALLOWED_ORIGINS` — your Vercel domain, e.g. `https://your-app.vercel.app`
    (any `*.vercel.app` preview origin is also allowed automatically)
  - `PORT` is injected by Render automatically.
- Do **not** set `SUPABASE_SERVICE_ROLE_KEY` here — it's only for the local sync (below).

Note the in-memory rate limiter (`backend/src/middleware/rateLimit.ts`) is per-instance;
it's fine for a single Render service but won't share counts if you scale to multiple instances.

### 2. Frontend → Vercel

- **Root Directory:** `frontend`
- **Framework Preset:** Vite
- **Build Command:** `npm run build` · **Output Directory:** `dist`
- **Environment variable:** `VITE_API_BASE_URL` — the Render backend origin, no trailing
  slash, e.g. `https://your-backend.onrender.com`
- `vercel.json` provides the SPA fallback so deep links (`/explore`, `/courses/CSCI1101`)
  don't 404.

After the frontend deploys, make sure `ALLOWED_ORIGINS` on Render matches its final domain.

### Data freshness

The database is populated by `npm run sync` (`backend/scripts/syncDatabase.ts`), which
pulls BC's course feeds + Avalanche evaluations. It requires `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` and is run **manually/locally** — the
service-role key bypasses RLS and must never be deployed or committed. Production data
stays as-is until you re-run sync.
