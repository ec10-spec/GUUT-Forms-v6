import mongoose from "mongoose";

// An account's workspace. Every user belongs to one company:
//   type "business"   : a paying organisation with admins, members and (optionally) its own database
//   type "individual" : a person's own workspace (one user, hosted by us)
// Forms and responses live in the company's own database when one is linked
// (customUriEncrypted), otherwise in our hosted storage (see config/db.js).
const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["individual", "business"], default: "business" },
    // Businesses: employees sign up with this code and an admin approves them.
    // Left ABSENT (not null) for individuals so the unique index only covers businesses.
    joinCode: { type: String, unique: true, sparse: true },
    joinEnabled: { type: Boolean, default: true },
    // Running total of stored form + response bytes. Counters are updated on every write and
    // corrected by a recalculation (see utils/storage.js); verifiedAt null = never measured.
    storage: {
      bytes: { type: Number, default: 0 },
      verifiedAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null }, // last time the total changed
    },
    billing: {
      plan: { type: String, default: null },            // business plan id (utils/plans.js)
      requestedPlan: { type: String, default: null },   // plan the admin asked for; the platform team activates it
      status: { type: String, enum: ["trialing", "active", "past_due", "canceled"], default: "active" },
      updatedAt: { type: Date, default: null },
    },
    customUriEncrypted: { type: String, default: null },
    dbHost: { type: String, default: null },  // display only, never credentials
    dbName: { type: String, default: null },  // display only
    dbCheckedAt: { type: Date, default: null },
    dbLinkedBy: { type: String, default: null },
  },
  { timestamps: true }
);

CompanySchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.dbMode = ret.customUriEncrypted ? "custom" : "hosted";
    delete ret.customUriEncrypted;
    return ret;
  },
});

export default mongoose.model("Company", CompanySchema);
