// Prefix for backend API calls.
// - Dev: VITE_API_BASE_URL is unset, so this is '' and calls stay relative
//   (e.g. '/api/courses/...') and hit the Vite dev proxy (see vite.config.ts).
// - Prod: set VITE_API_BASE_URL to the backend origin (e.g. the Render URL) so
//   the built site calls the API across origins.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export const api = (path: string) => `${API_BASE}${path}`
