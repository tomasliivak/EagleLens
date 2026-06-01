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
