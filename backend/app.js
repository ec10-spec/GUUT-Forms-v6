import "dotenv/config"; // must be first: other modules read env vars when imported
import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { assertEnv } from "./config/env.js";
import { connectPlatformDB, platformStatus } from "./config/db.js";
import { attachUser } from "./middleware/auth.js";
import { logger, log, requestLogger } from "./utils/logger.js";
import { ensureSuperadmin, migrateLegacyData } from "./utils/bootstrap.js";
import authRouter from "./routes/auth.js";
import formsRouter from "./routes/forms.js";
import submissionsRouter from "./routes/submissions.js";
import aiRouter from "./routes/ai.js";
import reportsRouter from "./routes/reports.js";
import adminRouter from "./routes/admin.js";
import companyRouter from "./routes/company.js";
import sharingRouter from "./routes/sharing.js";
import analysisRouter from "./routes/analysis.js";
import usageRouter from "./routes/usage.js";
import plansRouter from "./routes/plans.js";
import teamsRouter from "./routes/teams.js";
import notificationsRouter from "./routes/notifications.js";
import uploadsRouter from "./routes/uploads.js";
import cronRouter from "./routes/cron.js";

// The Express app, shared by both ways of running it:
//   server.js      a long-running process (local dev, Render, any VM)
//   api/index.js   a Vercel serverless function (one app per warm instance)

assertEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set("trust proxy", 1); // behind the host's proxy (Render, Vercel): real client IPs for rate limits + logs
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
const origins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
// Respondent-facing endpoints are open to every origin, so a form's downloaded
// HTML file works wherever it is opened: any website, a shared drive, or a
// file on someone's computer (Origin "null"). They never take an Authorization
// header from another origin, so this exposes nothing an anonymous respondent
// could not already do through the #/f/<id> link. Everything else follows CORS_ORIGIN.
const ID = "[a-f\\d]{24}";
const PUBLIC_ROUTES = [
  { methods: ["POST"], re: new RegExp(`^/api/submissions/${ID}/?$`, "i") },
  { methods: ["POST"], re: new RegExp(`^/api/uploads/${ID}/[^/]+/?$`, "i") },
  { methods: ["GET", "HEAD"], re: new RegExp(`^/api/forms/${ID}/?$`, "i") },
  { methods: ["GET", "HEAD"], re: new RegExp(`^/api/forms/${ID}/header-image/${ID}/?$`, "i") },
];
function isPublicRoute(req) {
  const method = req.method === "OPTIONS" ? String(req.header("access-control-request-method") || "").toUpperCase() : req.method;
  return PUBLIC_ROUTES.some((r) => r.methods.includes(method) && r.re.test(req.path));
}
const publicCors = cors({ origin: true, credentials: false, methods: ["GET", "HEAD", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Filename", "Accept"], maxAge: 86400 });
const appCors = cors(origins.length ? { origin: origins } : undefined);
app.use((req, res, next) => (isPublicRoute(req) ? publicCors : appCors)(req, res, next));
// Raised: base64 image/PDF attachments (AI generation, reports) exceed the default.
// On Vercel the platform caps any request body at 4.5 MB before it reaches this app.
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  const db = platformStatus();
  res.status(db.connected ? 200 : 503).json({ ok: db.connected, db: db.connected });
});

// Scheduled jobs (notification digests, cleanup). Before the rate limiter and auth: it has its own secret.
app.use("/api/cron", cronRouter);

app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 1500, standardHeaders: true, legacyHeaders: false }));
app.use("/api", attachUser, requestLogger);

app.use("/api/auth", authRouter);
app.use("/api/forms", formsRouter);
app.use("/api/submissions", submissionsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/company", companyRouter);
app.use("/api/sharing", sharingRouter);
app.use("/api/analysis", analysisRouter);
app.use("/api/usage", usageRouter);
app.use("/api/plans", plansRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Serve the built frontend when it exists (single-service deploy, e.g. Render).
// On Vercel the frontend is served as static files and never reaches this app.
const distDir = path.resolve(__dirname, "../frontend/dist");
if (!process.env.VERCEL && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  console.log("Serving built frontend from /frontend/dist");
}

// Central error handler: every thrown/rejected error in a route ends up here.
// 4xx messages are shown to the client; 5xx are logged to MongoDB and hidden.
app.use((err, req, res, _next) => {
  const status = err.status || (err.type === "entity.too.large" ? 413 : err.name === "ValidationError" || err.name === "CastError" ? 400 : 500);
  if (status >= 500) {
    if (err.logCompanyId) req.logCompanyId = err.logCompanyId;
    // A customer database being unreachable is that company's problem to fix, so it's filed under "db".
    const category = err.code === "COMPANY_DB_DOWN" ? "db" : "server_error";
    log({ level: "error", category, err: err.cause && status === 503 ? err.cause : err, req, statusCode: status, meta: { code: err.code } });
  }
  if (res.headersSent) return;
  res.status(status).json({
    error: status >= 500 && !err.code ? "Something went wrong on our end. The team has been notified." : status === 413 && !err.code ? "That file is too large." : err.message,
    ...(err.code ? { code: err.code } : {}),
    ...(Array.isArray(err.fields) ? { fields: err.fields.map(({ fieldId, message }) => ({ fieldId, message })) } : {}),
  });
});

/**
 * Connects to the platform database and runs the start-up checks, once per process.
 * Safe to call on every request: later calls reuse the same promise. A failed start
 * is forgotten so the next request tries again (a serverless instance stays usable).
 */
let ready = null;
export function init() {
  if (!ready) {
    ready = (async () => {
      await connectPlatformDB();
      await migrateLegacyData();
      await ensureSuperadmin();
      logger.info("system", process.env.VERCEL ? "Function instance started" : "Server started");
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export default app;
