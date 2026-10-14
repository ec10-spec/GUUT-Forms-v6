import { httpError } from "./http.js";

// ---------------------------------------------------------------------------
// ACCOUNT TYPES AND PRICING. Edit this file to change what the app shows and enforces.
// !! The business prices and limits below are PLACEHOLDERS. Set real numbers from
// !! your database and hosting cost before launch. Individuals are unlimited for now.
// ---------------------------------------------------------------------------

const num = (v) => (v === undefined || v === "" || v === null ? null : Number(v));

export const INDIVIDUAL = {
  id: "individual",
  name: "Free",
  tagline: "For students, creators and small groups",
  priceLabel: "$0",
  note: "Usage-based pricing will be added later. There is no limit today.",
  features: ["Unlimited forms and responses (for now)", "Charts, PDF export and response import", "Share forms and create team spaces with anyone", "AI assistant with your own key. $5 free AI credit coming soon", "Hosted by us, nothing to set up"],
  // null = unlimited. Set INDIVIDUAL_MAX_FORMS / INDIVIDUAL_MAX_RESPONSES_PER_MONTH to start enforcing.
  limits: () => ({ maxForms: num(process.env.INDIVIDUAL_MAX_FORMS), maxResponsesPerMonth: num(process.env.INDIVIDUAL_MAX_RESPONSES_PER_MONTH), maxStorageMb: num(process.env.INDIVIDUAL_MAX_STORAGE_MB) }),
};

export const BUSINESS_PLANS = [
 { id: "starter", name: "Starter", priceLabel: "$29 / month", placeholder: true, maxSeats: 5, maxStorageMb: 500, features: ["Everything in Free", "Up to 5 team members", "500 MB hosted storage", "Company join link and approvals", "Connect your own database", "Run on your own server", "Remove GUUT branding from public forms"] },
 { id: "growth", name: "Growth", priceLabel: "$99 / month", placeholder: true, maxSeats: 25, maxStorageMb: 5120, features: ["Up to 25 team members", "5 GB hosted storage", "Everything in Starter", "Team usage tracking for admins"] },
 { id: "scale", name: "Scale", priceLabel: "Custom", placeholder: true, maxSeats: null, maxStorageMb: null, features: ["Unlimited team members", "Custom storage", "Everything in Growth", "Help with onboarding and a dedicated database"] },
];

export const planById = (id) => BUSINESS_PLANS.find((p) => p.id === id) || null;

/** Public pricing shown on the login page. */
export const publicPlans = () => {
  const mb = INDIVIDUAL.limits().maxStorageMb;
  const storage = mb == null ? "Unlimited storage (for now)" : `${mb} MB of storage`;
  return {
    individual: { ...INDIVIDUAL, features: [storage, ...INDIVIDUAL.features], limits: undefined },
    business: BUSINESS_PLANS,
    pricingIsPlaceholder: BUSINESS_PLANS.some((p) => p.placeholder),
  };
};
// Billing is recorded now but only ENFORCED when ENFORCE_BILLING=true, because there is no
// payment processor yet: the platform team activates a business by setting its status.
export const billingEnforced = () => String(process.env.ENFORCE_BILLING || "").toLowerCase() === "true";

export function assertBillingOk(company) {
  if (!billingEnforced() || !company || company.type !== "business") return;
  if (!["trialing", "active"].includes(company.billing?.status)) {
    throw httpError(402, "This company's subscription isn't active. A company admin can review the plan under Admin > Billing.", { code: "BILLING_INACTIVE" });
  }
}

export function assertSeatAvailable(company, currentSeats) {
  if (!billingEnforced() || company?.type !== "business") return;
  const max = planById(company.billing?.plan)?.maxSeats;
  if (max != null && currentSeats >= max) throw httpError(402, `Your ${planById(company.billing.plan).name} plan includes ${max} team members. Upgrade the plan to add more.`, { code: "SEAT_LIMIT" });
}

/** Individuals only (business limits are seats). Called before creating a form. */
export async function assertCanCreateForm(company, tenant, userId, FormIndex) {
  if (company?.type !== "individual") return;
  const max = INDIVIDUAL.limits().maxForms;
  if (max == null) return;
  if ((await FormIndex.countDocuments({ companyId: company._id })) >= max) {
    throw httpError(402, `The free plan includes ${max} forms. Delete one or upgrade to add more.`, { code: "FORM_LIMIT" });
  }
}

/** Individuals only. Called before accepting a response. */
export async function assertCanReceiveResponse(company, tenant, FormIndex) {
  if (company?.type !== "individual") return;
  const max = INDIVIDUAL.limits().maxResponsesPerMonth;
  if (max == null) return;
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const ids = (await FormIndex.find({ companyId: company._id }).select("_id")).map((i) => i._id);
  if ((await tenant.Submission.countDocuments({ formId: { $in: ids }, createdAt: { $gte: start } })) >= max) {
    throw httpError(503, "This form has reached its response limit for this month. Please try again later.", { code: "RESPONSE_LIMIT" });
  }
}
