import mongoose from "mongoose";

// One row per AI generation call (platform DB). Used by the daily limiter and
// the usage summary.
const TokenUsageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    provider: { type: String, default: "anthropic" },
    model: { type: String, default: "" },
    promptTokens: { type: Number, required: true },
    completionTokens: { type: Number, required: true },
    totalTokens: { type: Number, required: true },
    viaPlatform: { type: Boolean, default: false },
    costUsd: { type: Number, default: 0 },
    endpoint: { type: String, default: "ai_generate_form" },
  },
  { timestamps: true }
);

export default mongoose.model("TokenUsage", TokenUsageSchema);
