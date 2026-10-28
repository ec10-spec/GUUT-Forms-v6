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
import { startNotificationScheduler } from "./utils/notify.js";
import { purgeStaleUnverified, warnIfMisconfigured } from "./utils/emailVerification.js";

assertEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set("trust proxy", 1); // behind Render's proxy: real client IPs for rate limits + logs
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
const origins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : undefined));
// Raised: base64 image/PDF attachments (AI generation, reports) exceed the default.
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  const db = platformStatus();
  res.status(db.connected ? 200 : 503).json({ ok: db.connected, db: db.connected });
});

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
const distDir = path.resolve(__dirname, "../frontend/dist");
if (fs.existsSync(distDir)) {
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

process.on("unhandledRejection", (reason) => {
  logger.error("server_error", "unhandledRejection", { err: reason instanceof Error ? reason : new Error(String(reason)) });
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  // State may be corrupt: record it, then exit so the host restarts a clean process.
  Promise.race([log({ level: "error", category: "server_error", message: "uncaughtException", err }), new Promise((r) => setTimeout(r, 2000))]).finally(() => process.exit(1));
});

const PORT = process.env.PORT || 4000;
connectPlatformDB()
  .then(async () => {
    await migrateLegacyData();
    await ensureSuperadmin();
    app.listen(PORT, () => {
      console.log(`GUUT Forms API on :${PORT}`);
      logger.info("system", "Server started");
      startNotificationScheduler();
      warnIfMisconfigured();
      setInterval(() => purgeStaleUnverified().catch(() => {}), 3600 * 1000).unref();
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });
