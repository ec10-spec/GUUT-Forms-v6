// Long-running server: local dev, Render or any VM. On Vercel, api/index.js is used instead.
import app, { init } from "./app.js";
import { logger, log } from "./utils/logger.js";
import { startNotificationScheduler } from "./utils/notify.js";
import { purgeStaleUnverified, warnIfMisconfigured } from "./utils/emailVerification.js";

process.on("unhandledRejection", (reason) => {
  logger.error("server_error", "unhandledRejection", { err: reason instanceof Error ? reason : new Error(String(reason)) });
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  // State may be corrupt: record it, then exit so the host restarts a clean process.
  Promise.race([log({ level: "error", category: "server_error", message: "uncaughtException", err }), new Promise((r) => setTimeout(r, 2000))]).finally(() => process.exit(1));
});

const PORT = process.env.PORT || 4000;
init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GUUT Forms API on :${PORT}`);
      startNotificationScheduler();
      warnIfMisconfigured();
      setInterval(() => purgeStaleUnverified().catch(() => {}), 3600 * 1000).unref();
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });
