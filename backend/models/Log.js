import mongoose from "mongoose";

// One backend-written record per notable event, stored in the platform DB.
// Replaces the old UI-side reports list. Auto-deleted after LOG_RETENTION_DAYS
// so logs can't fill up a free-tier database.
const days = Number(process.env.LOG_RETENTION_DAYS || 30);

const LogSchema = new mongoose.Schema(
  {
    level: { type: String, enum: ["info", "warn", "error"], default: "info", index: true },
    // auth | form | ai | admin | db | http | server_error | client_error | user_report | system
    category: { type: String, default: "system", index: true },
    message: { type: String, default: "" },
    route: { type: String, default: "" },
    statusCode: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    userId: { type: String, default: null },
    companyId: { type: String, default: null },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    url: { type: String, default: "" },        // page the user was on (client logs / reports)
    stack: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    // user_report only
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    attachment: {
      name: { type: String, default: null },
      mediaType: { type: String, default: null },
      base64: { type: String, default: null, select: false },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
LogSchema.index({ createdAt: -1 });
LogSchema.index({ createdAt: 1 }, { expireAfterSeconds: Math.max(1, days) * 86400 });

const Log = mongoose.model("Log", LogSchema);
// Index problems (e.g. the TTL cleanup) should be visible but must never stop the server.
Log.on("index", (err) => err && console.warn("Log index warning:", err.message));
export default Log;
