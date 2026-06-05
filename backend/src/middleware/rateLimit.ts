import rateLimit from "express-rate-limit";

// General limiter for fast, DB-backed reads (courses, rankings).
// Browsing + the debounced search bar + explore filter changes can each fire
// a handful of requests in quick succession, so this is intentionally roomy;
// it only kicks in against scraping/abuse, not normal use.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down and try again shortly." },
});
