import { isAdminOf } from "../middleware/auth.js";

// Per-form access. One place decides who may do what, so routes can't drift apart.
//   owner / admin : everything, including delete and sharing
//   editor        : edit, publish, view responses
//   viewer        : open the form read-only, view responses and charts
// A collaborator entry only counts while the person is STILL in the form's own
// company, so moving a user to another company can never carry access with them.
const RANK = { viewer: 1, editor: 2, admin: 3, owner: 3 };

export function accessOf(req, idx) {
  if (!req.userId || !req.user || !idx) return null;
  if (idx.ownerId === req.userId) return "owner";
  if (isAdminOf(req, idx.companyId)) return "admin";
  const sameCompany = String(req.user.companyId) === String(idx.companyId);
  let best = null;
  // Business sharing never leaves the company. The one exception is an "external" share made by an
  // individual account (to any other account), which can only be created by routes/sharing.js.
  const c = (idx.collaborators || []).find((x) => x.userId === req.userId);
  if (c && (c.external || sameCompany)) best = c.role;
  // Team access: the highest role among the teams this person belongs to right now.
  // Open teams (made by individuals) also reach across accounts, so those shares are flagged "external".
  if (req.teamIds?.size) {
    for (const s of idx.teamShares || []) {
      if ((sameCompany || s.external) && req.teamIds.has(s.teamId) && RANK[s.role] > (RANK[best] || 0)) best = s.role;
    }
  }
  return best;
}

export const canView = (a) => !!a;
export const canEdit = (a) => (RANK[a] || 0) >= 2;
export const canManage = (a) => a === "owner" || a === "admin";
export const rankOf = (role) => RANK[role] || 0;
