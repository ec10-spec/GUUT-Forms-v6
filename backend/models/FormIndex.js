import mongoose from "mongoose";

// Lightweight directory in the PLATFORM db: which company (and therefore which
// database) a form lives in, so public links, /explore and submissions can find
// the right database without scanning every customer's. Holds only listing
// metadata; the form itself and all responses stay in the company's database.
// Title/description are kept here ONLY for forms the owner chose to list on
// Explore; private forms are indexed by id alone.
const FormIndexSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    ownerId: { type: String, required: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    fieldCount: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    // Per-form sharing. Only people in the same company can ever appear here
    // (enforced on every write and re-checked on every read, see utils/access.js).
    // Stores user ids and roles only, never form content.
    collaborators: {
      type: [new mongoose.Schema(
        {
          userId: { type: String, required: true },
          role: { type: String, enum: ["viewer", "editor"], required: true },
          addedBy: { type: String, default: null },
          // true = a person from ANOTHER individual workspace (individuals have no team, so they
          // share across accounts). Only ever set between two individual accounts.
          external: { type: Boolean, default: false },
          addedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      )],
      default: [],
    },
    // Forms shared with a whole team (see models/Team.js). Access = the team's role for its current members.
    teamShares: {
      type: [new mongoose.Schema(
        {
          teamId: { type: String, required: true },
          role: { type: String, enum: ["viewer", "editor"], required: true },
          addedBy: { type: String, default: null },
          // true = an open team (created by an individual): its members may come from other accounts.
          external: { type: Boolean, default: false },
          addedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      )],
      default: [],
    },
    // Business forms: listing in the public repository needs a company admin's approval.
    // status: "none" | "pending" | "approved" | "denied". Individuals list instantly (status stays "none").
    listing: {
      status: { type: String, enum: ["none", "pending", "approved", "denied"], default: "none" },
      requestedBy: { type: String, default: null },
      requestedAt: { type: Date, default: null },
      decidedBy: { type: String, default: null },
    },
    // Pending "can I get access?" requests from teammates.
    accessRequests: {
      type: [new mongoose.Schema(
        {
          userId: { type: String, required: true },
          role: { type: String, enum: ["viewer", "editor"], default: "viewer" },
          message: { type: String, default: "", maxlength: 300 },
          createdAt: { type: Date, default: Date.now },
        },
        { _id: false }
      )],
      default: [],
    },
  },
  { timestamps: true }
);
FormIndexSchema.index({ isPublic: 1, publishedAt: -1 });
FormIndexSchema.index({ "collaborators.userId": 1 });
FormIndexSchema.index({ "teamShares.teamId": 1 });
FormIndexSchema.index({ "listing.status": 1, companyId: 1 });

const FormIndex = mongoose.model("FormIndex", FormIndexSchema);
export default FormIndex;

/** Upserts the directory entry for a form (same _id as the form). */
export function syncIndex(form, companyId) {
  return FormIndex.findByIdAndUpdate(
    form._id,
    {
      companyId,
      ownerId: form.ownerId,
      title: form.isPublic ? form.title : "",
      description: form.isPublic ? form.description || "" : "",
      fieldCount: form.isPublic ? form.fields?.length || 0 : 0,
      isPublic: !!form.isPublic,
      publishedAt: form.publishedAt || null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
