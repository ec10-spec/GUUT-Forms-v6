import mongoose from "mongoose";

// Batching state for "send after every N hours / N responses" notifications.
// Holds counts only (never response content). One row per form with responses
// waiting to be announced to its creator.
const NotifyStateSchema = new mongoose.Schema(
  {
    formId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // The person who will receive the email (the form's creator, or someone it was shared with who opted in).
    ownerId: { type: String, required: true },
    pendingCount: { type: Number, default: 0 },
    firstPendingAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);
NotifyStateSchema.index({ formId: 1, ownerId: 1 }, { unique: true });
NotifyStateSchema.index({ pendingCount: 1 });

export default mongoose.model("NotifyState", NotifyStateSchema);
