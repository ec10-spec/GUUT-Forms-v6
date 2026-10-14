import mongoose from "mongoose";

// These two collections live in the CUSTOMER's database (or in ours as a
// fallback for companies that haven't linked one). They are schemas only; the
// models are bound to a connection per company in config/db.js.

const FieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ["text", "textarea", "number", "email", "date", "checkbox", "select", "file", "rating"],
      required: true,
    },
    label: { type: String, required: true, trim: true },
    placeholder: { type: String, default: "" },
    required: { type: Boolean, default: false },
    options: [{ type: String }],
    order: { type: Number, required: true },
    showIf: {
      fieldId: { type: String, default: null },
      equals: { type: String, default: null },
    },
  },
  { _id: false }
);

const OPTION_TYPES = new Set(["checkbox", "select"]);
FieldSchema.path("label").validate((v) => v.trim().length > 0, "Every field needs a label.");

export const FormSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    ownerId: { type: String, required: true, index: true },
    fields: {
      type: [FieldSchema],
      validate: {
        validator: (fields) =>
          fields.every((f) => !OPTION_TYPES.has(f.type) || (f.options && f.options.filter((o) => o.trim()).length >= 1)),
        message: "Checkbox and single-select fields need at least one option.",
      },
    },
    source: { type: String, enum: ["manual", "ai_generated", "ai_generated_edited"], default: "manual" },
    generationPrompt: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    isPublic: { type: Boolean, default: false },
    sizeBytes: { type: Number, default: 0 }, // approximate stored size, kept for storage tracking
    theme: {
      primaryColor: { type: String, default: "#001549" },
      backgroundColor: { type: String, default: "#f6f7fb" },
      headerImage: { type: String, default: null },
    },
  },
  { timestamps: true }
);
FormSchema.path("title").validate((v) => v.trim().length > 0, "Form title is required.");

export const SubmissionSchema = new mongoose.Schema(
  {
    formId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    answers: { type: mongoose.Schema.Types.Mixed, required: true }, // { fieldId: value }
    sizeBytes: { type: Number, default: 0 },
    imported: { type: Boolean, default: false }, // true = uploaded from an older file, not collected through the form
  },
  { timestamps: true }
);
