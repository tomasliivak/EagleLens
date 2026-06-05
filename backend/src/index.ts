import express, { type NextFunction, type Request, type Response } from 'express'
import coursesRouter from "./routes/coursesRoutes.ts";
import rankingsRouter from "./routes/rankingsRoutes.ts";
import searchRouter from "./routes/searchRoutes.ts";
import { apiLimiter } from "./middleware/rateLimit.ts";
import cors, { type CorsOptions } from 'cors'

const app = express()
const PORT = process.env.PORT ?? 3000

// Trust the first proxy hop (e.g. Vite dev proxy / a hosting reverse proxy) so
// rate limiting keys off the real client IP rather than the proxy's.
app.set("trust proxy", 1)

// In production set ALLOWED_ORIGINS to a comma-separated list of frontend origins
// (e.g. "https://planurbc.vercel.app"). We also allow any *.vercel.app origin so
// Vercel preview deployments work. With ALLOWED_ORIGINS unset (local dev), allow
// all origins so nothing needs configuring locally.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // No Origin header = same-origin / curl / health checks — always allow.
    if (!origin || allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
};

app.use(cors(corsOptions))
app.use(express.json())

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.get('/api/hello', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from the PlanYourBC backend!' })
})

app.use("/api/courses", apiLimiter, coursesRouter);
app.use("/api/rankings", apiLimiter, rankingsRouter);
app.use("/api/search", apiLimiter, searchRouter);

// Last-resort error handler so a thrown/rejected request returns a clean 500
// instead of leaking internals. Controllers still handle their own known errors.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled request error:", err)
  if (res.headersSent) return
  res.status(500).json({ error: "Internal server error" })
})

// Log stray rejections/exceptions rather than dying silently.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
})

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`)
})
