import { decrypt } from "../utils/crypto.js";
import mongoose from "mongoose";

// Account types:
//   superadmin - us, the platform operator: all companies, users, platform logs
//   admin      - a customer company's administrator: links the company's own
//                database, manages its team, sees problems with its forms
//   user       - regular customer user: builds forms, manages own AI settings
const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "admin", "user"], default: "user" },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    settings: {
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      // Legacy single Anthropic key from v0.1; still read as a fallback.
      aiApiKeyEncrypted: { type: String, default: null },
    },
    // Self-service sign-ups must confirm their email before they can sign in. Accounts created by
    // an admin, and accounts that existed before this was added, count as confirmed.
    emailVerified: { type: Boolean, default: true },
    emailVerification: { tokenHash: { type: String, default: null }, expiresAt: { type: Date, default: null } },
    // "Forgot password": a single-use link (only its hash is stored).
    passwordReset: { tokenHash: { type: String, default: null }, expiresAt: { type: Date, default: null } },
    // Bumped whenever the password changes (or an admin resets it). Sign-in tokens carry the version they
    // were issued with, and older ones stop working, so a changed password signs out every other device.
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null },
    // Employees who signed up with a company code wait here until a company admin approves them.
    // pending/declined users have no company (and so no forms) until then.
    membership: {
      status: { type: String, enum: ["active", "pending", "declined"], default: "active" },
      requestedCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
      requestedAt: { type: Date, default: null },
    },
    // Email notification preferences (per user, apply to the forms they created).
    notifications: {
      // Company admins: told when someone in the company creates a form.
      formCreated: { type: Boolean, default: true },
      // Form creators: told about new responses to their forms.
      responses: {
        enabled: { type: Boolean, default: true },
        mode: { type: String, enum: ["every", "hours", "count"], default: "every" }, // every response | every N hours | every N responses
        hours: { type: Number, default: 24, min: 1, max: 168 },
        count: { type: Number, default: 10, min: 2, max: 1000 },
      },
      // Owners/admins: told when a teammate asks for access to a form.
      accessRequests: { type: Boolean, default: true },
      // Anyone: also get response emails for forms SHARED with them (directly or through a team). Off by default.
      sharedResponses: { type: Boolean, default: false },
    },
    // Bring-your-own AI. Keys are encrypted at rest and never sent to the client.
    ai: {
      provider: { type: String, enum: ["anthropic", "openai"], default: "anthropic" },
      anthropicKeyEncrypted: { type: String, default: null },
      openaiKeyEncrypted: { type: String, default: null },
      anthropicModel: { type: String, default: "" },
      openaiModel: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

const hintOf = (enc) => { try { return enc ? decrypt(enc).slice(-4) : ""; } catch { return ""; } };

UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.emailVerification;
    delete ret.passwordReset;
    delete ret.tokenVersion;
    const ai = ret.ai || {};
    ret.ai = {
      provider: ai.provider || "anthropic",
      hasAnthropicKey: !!(ai.anthropicKeyEncrypted || ret.settings?.aiApiKeyEncrypted),
      hasOpenaiKey: !!ai.openaiKeyEncrypted,
      anthropicHint: hintOf(ai.anthropicKeyEncrypted || ret.settings?.aiApiKeyEncrypted),
      openaiHint: hintOf(ai.openaiKeyEncrypted),
      anthropicModel: ai.anthropicModel || "",
      openaiModel: ai.openaiModel || "",
    };
    ret.hasAiApiKey = ret.ai.provider === "openai" ? ret.ai.hasOpenaiKey : ret.ai.hasAnthropicKey;
    if (ret.settings) delete ret.settings.aiApiKeyEncrypted;
    delete ret.passwordHash;
    return ret;
  },
});

/** Sets a new password and invalidates every existing session. */
UserSchema.methods.setPasswordHash = function setPasswordHash(hash) {
  this.passwordHash = hash;
  this.tokenVersion = (this.tokenVersion || 0) + 1;
  this.passwordChangedAt = new Date();
  this.passwordReset = { tokenHash: null, expiresAt: null };
};

export default mongoose.model("User", UserSchema);
