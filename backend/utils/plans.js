import { httpError } from "./http.js";

// ---------------------------------------------------------------------------
// ACCOUNT TYPES AND PRICING. Edit this file to change what the app shows and enforces.
// !! The business prices and limits below are PLACEHOLDERS. Set real numbers from
// !! your database and hosting cost before launch. Individuals are unlimited for now.
// ---------------------------------------------------------------------------

const num = (v) => (v === undefined || v === "" || v === null ? null : Number(v));

// Pricing format agreed with the team (Nov 2026): Freemium, Teams, Servers. Prices are placeholders.
// The free plan advertises FREEMIUM_FORMS forms; the limit is only ENFORCED when INDIVIDUAL_MAX_FORMS is set.
export const FREEMIUM_FORMS = 10;

export const INDIVIDUAL = {
  id: "individual",
  name: "Freemium",
  tagline: "For individuals",
  priceLabel: "$0",
  note: "Prices are placeholders while pricing is reviewed.",
  features: ["All form building and sharing", "Bring your own AI key (Claude or ChatGPT)", `Up to ${FREEMIUM_FORMS} forms`],
  // null = unlimited. Set INDIVIDUAL_MAX_FORMS / INDIVIDUAL_MAX_RESPONSES_PER_MONTH to start enforcing.
  limits: () => ({ maxForms: num(process.env.INDIVIDUAL_MAX_FORMS), maxResponsesPerMonth: num(process.env.INDIVIDUAL_MAX_RESPONSES_PER_MONTH), maxStorageMb: num(process.env.INDIVIDUAL_MAX_STORAGE_MB) }),
};

// Plan ids stay stable because companies store them: "starter" is now Teams, "scale" is now Servers.
// "growth" (the old $59 / 25 people tier) is retired: hidden from every price list, still valid for
// companies already on it.
export const BUSINESS_PLANS = [
  { id: "starter", name: "Teams", priceLabel: "$29 / month", seatsLabel: "up to 10 people", placeholder: true, maxSeats: 10, maxStorageMb: 1024, features: ["Everything in Freemium", "Team admin and invites", "Company activity logs", "More forms, shared by the team"], upgradeNote: "Upgrade from inside the app. No new sign-up." },
  { id: "scale", name: "Servers", priceLabel: "Contact us", tagline: "For companies that run it on their own servers", placeholder: true, contact: true, maxSeats: null, maxStorageMb: null, features: ["Your own install and your own database", "GUUT has no access to your data", "Price set for your team"] },
  { id: "growth", name: "Growth (retired)", priceLabel: "$59 / month", retired: true, placeholder: true, maxSeats: 25, maxStorageMb: 5120, features: ["Up to 25 team members", "Everything in Teams"] },
];
export const ACTIVE_PLANS = BUSINESS_PLANS.filter((p) => !p.retired);

export const planById = (id) => BUSINESS_PLANS.find((p) => p.id === id) || null;
/** Plans a company may choose now (retired plans only for the company already on one). */
export const choosablePlan = (id, currentId = null) => { const p = planById(id); return p && (!p.retired || p.id === currentId) ? p : null; };

/** Public pricing shown on the login page. */
export const publicPlans = () => {
  const mb = INDIVIDUAL.limits().maxStorageMb;
  return {
    individual: { ...INDIVIDUAL, features: mb == null ? INDIVIDUAL.features : [...INDIVIDUAL.features, `${mb} MB of storage`], limits: undefined },
    business: ACTIVE_PLANS,
    aiNote: "AI runs on your own key, so you only pay your AI provider for what you use. A typical form costs about 1 to 2 cents.",
    pricingIsPlaceholder: ACTIVE_PLANS.some((p) => p.placeholder),
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
