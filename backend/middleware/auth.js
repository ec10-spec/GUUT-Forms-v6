import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Company from "../models/Company.js";
import Team from "../models/Team.js";
import { getTenant } from "../config/db.js";
import { httpError } from "../utils/http.js";
import { assertBillingOk } from "../utils/plans.js";

const secret = () => process.env.JWT_SECRET || "guut-forms-dev-secret-change-me";

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), v: user.tokenVersion || 0 }, secret(), { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}

// Runs on every /api request. Resolves the Bearer token (if any) to the user
// record, so role, company and active status are always current. A bad/expired
// token just means "anonymous"; a database failure is a real error.
// (The old x-user-id header fallback was removed: it let anyone impersonate
// any user by guessing an id.)
export async function attachUser(req, _res, next) {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch {
    return next();
  }
  const user = await User.findById(payload.sub);
  // A token issued before the last password change is no longer valid.
  if (user && user.active && (payload.v || 0) === (user.tokenVersion || 0)) {
    req.user = user;
    req.userId = String(user._id);
    // Teams this person is in right now (used by utils/access.js), so membership changes apply at once.
    // Includes open teams (made by individuals) that can span accounts; utils/access.js decides
    // which of them count for a given form.
    req.teamIds = new Set();
    const teams = await Team.find({ "members.userId": req.userId }).select("_id");
    for (const t of teams) req.teamIds.add(String(t._id));
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw httpError(401, "Sign in required.");
  next();
}

export function requireSuperadmin(req, _res, next) {
  if (!req.user) throw httpError(401, "Sign in required.");
  if (req.user.role !== "superadmin") throw httpError(403, "Superadmin access required.");
  next();
}

export const isSuperadmin = (req) => req.user?.role === "superadmin";

/** Company admins (and superadmins). Company-scoped routes always use the caller's OWN companyId. */
export function requireCompanyAdmin(req, _res, next) {
  if (!req.user) throw httpError(401, "Sign in required.");
  if (!["admin", "superadmin"].includes(req.user.role)) throw httpError(403, "Admin access required.");
  next();
}

/** May this caller see/manage everything in the given company's forms? (company admin of THAT company, or superadmin) */
export const isAdminOf = (req, companyId) =>
  isSuperadmin(req) || (req.user?.role === "admin" && String(req.user.companyId) === String(companyId));

/** Loads the caller's company and the database connection that holds its data. */
export async function withTenant(req, _res, next) {
  if (!req.user.companyId) {
    throw httpError(403, req.user.membership?.status === "declined"
      ? "Your request to join the company was declined."
      : "Your account is waiting for your company admin's approval.", { code: "MEMBERSHIP_PENDING" });
  }
  req.company = await Company.findById(req.user.companyId);
  assertBillingOk(req.company);
  req.tenant = await getTenant(req.company);
  next();
}

/** Tenant for a given company id (used for public links and cross-company reads). */
// publicFacing: respondents get a neutral message instead of company/database details.
export async function tenantForCompanyId(companyId, { publicFacing = false } = {}) {
  const company = await Company.findById(companyId);
  if (!company) throw httpError(404, "Form not found");
  try {
    return await getTenant(company);
  } catch (err) {
    if (publicFacing) throw httpError(503, "This form is temporarily unavailable. Please try again later.", { code: err.code, cause: err.cause || err, logCompanyId: company._id });
    throw err;
  }
}
