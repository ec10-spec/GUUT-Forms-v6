import mongoose from "mongoose";

// A named group of people. Business teams stay inside ONE company (for example "Marketing"); teams
// created by individuals are "open" and can include anyone with an account. Share a form with the
// whole team in one step; membership changes apply immediately because access is worked out per request.
const TeamSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameLower: { type: String, required: true },
    createdBy: { type: String, default: null },
    // true = created by an individual account: members can be anyone with an account (friends, a class,
    // a club). false = a business team, limited to that company's own people.
    open: { type: Boolean, default: false },
    members: {
      type: [new mongoose.Schema({ userId: { type: String, required: true }, addedBy: { type: String, default: null }, addedAt: { type: Date, default: Date.now } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true }
);
TeamSchema.index({ companyId: 1, nameLower: 1 }, { unique: true });
TeamSchema.index({ "members.userId": 1 });

export default mongoose.model("Team", TeamSchema);
