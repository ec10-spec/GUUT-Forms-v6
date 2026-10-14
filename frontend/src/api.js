// API base. Same-origin by default (single-service deploy or local proxy).
// For a split deploy (e.g. frontend on Cloudflare Pages, backend on Render),
// set VITE_API_BASE to the backend URL at build time and everything retargets.
const ORIGIN = (import.meta.env?.VITE_API_BASE || "").replace(/\/$/, "");
const BASE = `${ORIGIN}/api`;

// --- session (token kept in localStorage) ---------------------------------
const TOKEN_KEY = "guut_token";
const USER_KEY = "guut_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}
export function saveSession({ token, user }) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function saveUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(BASE + path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // A rejected token means the session is over (expired, or account disabled).
    if (res.status === 401 && token) window.dispatchEvent(new Event("guut:session-expired"));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const api = {
  // auth
  login: (email, password) => request("/auth/login", json("POST", { email, password })),
  signup: (payload) => request("/auth/signup", json("POST", payload)),
  teams: () => request("/teams"),
  teamCreate: (name) => request("/teams", json("POST", { name })),
  team: (id) => request(`/teams/${id}`),
  teamRename: (id, name) => request(`/teams/${id}`, json("PUT", { name })),
  teamDelete: (id) => request(`/teams/${id}`, { method: "DELETE" }),
  teamEligible: (id) => request(`/teams/${id}/eligible`),
  teamAddMember: (id, email) => request(`/teams/${id}/members`, json("POST", { email })),
  teamRemoveMember: (id, userId) => request(`/teams/${id}/members/${userId}`, { method: "DELETE" }),
  shareTeamAdd: (id, teamId, role) => request(`/sharing/forms/${id}/teams`, json("POST", { teamId, role })),
  shareTeamRole: (id, teamId, role) => request(`/sharing/forms/${id}/teams/${teamId}`, json("PUT", { role })),
  shareTeamRemove: (id, teamId) => request(`/sharing/forms/${id}/teams/${teamId}`, { method: "DELETE" }),
  verifyEmail: (token) => request("/auth/verify", json("POST", { token })),
  resendVerification: (email) => request("/auth/resend-verification", json("POST", { email })),
  continueIndividual: () => request("/auth/continue-individual", { method: "POST" }),
  plans: () => request("/plans"),
  joinInfo: (code) => request(`/auth/join-info?code=${encodeURIComponent(code)}`),
  requestJoin: (joinCode) => request("/auth/request-join", json("POST", { joinCode })),
  cancelJoin: () => request("/auth/cancel-join", { method: "POST" }),
  approvals: () => request("/company/approvals"),
  listingApprove: (formId) => request(`/company/listings/${formId}/approve`, { method: "POST" }),
  listingDeny: (formId) => request(`/company/listings/${formId}/deny`, { method: "POST" }),
  importPreview: (formId, payload) => request(`/submissions/${formId}/import/preview`, json("POST", payload)),
  importResponses: (formId, payload) => request(`/submissions/${formId}/import`, json("POST", payload)),
  me: () => request("/auth/me"),
  updateSettings: (payload) => request("/auth/settings", json("PUT", payload)),
  changePassword: (currentPassword, newPassword) => request("/auth/password", json("PUT", { currentPassword, newPassword })),

  // forms
  listForms: (q = "") => request(`/forms?q=${encodeURIComponent(q)}`),
  listPublicForms: (q = "") => request(`/forms/public?q=${encodeURIComponent(q)}`),
  getForm: (id) => request(`/forms/${id}`),
  createForm: (form) => request("/forms", json("POST", form)),
  updateForm: (id, form) => request(`/forms/${id}`, json("PUT", form)),
  publishForm: (id) => request(`/forms/${id}/publish`, { method: "POST" }),
  duplicateForm: (id) => request(`/forms/${id}/duplicate`, { method: "POST" }),
  deleteForm: (id) => request(`/forms/${id}`, { method: "DELETE" }),

  // submissions
  submit: (formId, answers) => request(`/submissions/${formId}`, json("POST", { answers })),
  listSubmissions: (formId, q = "") => request(`/submissions/${formId}?q=${encodeURIComponent(q)}`),
  // CSV needs the auth header, so it's fetched and saved as a file (a bare link can't send it).
  async downloadCsv(formId, title = "form") {
    const res = await fetch(`${BASE}/submissions/${formId}/export.csv`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w-]+/g, "_")}_submissions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async downloadPdf(formId, title = "form") {
    const res = await fetch(`${BASE}/submissions/${formId}/export.pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
    const url = URL.createObjectURL(await res.blob());
    const el = document.createElement("a");
    el.href = url;
    el.download = `${title.replace(/[^\w-]+/g, "_")}_responses.pdf`;
    el.click();
    URL.revokeObjectURL(url);
  },

  // ai
  generateForm: (prompt, { maxTokens, attachment } = {}) =>
    request("/ai/generate-form", json("POST", { prompt, maxTokens, attachment })),
  testAi: () => request("/ai/test", { method: "POST" }),
  getAiBudget: () => request("/ai/budget"),

  // problem reports + automatic front-end error logging (stored by the backend)
  submitReport: (payload) => request("/reports", json("POST", payload)),
  logClientError: (payload) =>
    fetch(`${BASE}/reports/client`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {}),

  // company admin (always scoped to the caller's own company on the server)
  companyInfo: () => request("/company"),
  companyTestDb: (uri) => request("/company/database/test", json("POST", { uri })),
  companyLinkDb: (uri, migrate) => request("/company/database", json("PUT", { uri, migrate })),
  companyCheckDb: () => request("/company/database/check", { method: "POST" }),
  companyUsers: () => request("/company/users"),
  companyAddUser: (payload) => request("/company/users", json("POST", payload)),
  companyUpdateUser: (id, payload) => request(`/company/users/${id}`, json("PUT", payload)),
  companyJoin: () => request("/company/join"),
  companyJoinEnabled: (enabled) => request("/company/join", json("PUT", { enabled })),
  companyJoinRegenerate: () => request("/company/join/regenerate", { method: "POST" }),
  companyJoinDecide: (id, approve) => request(`/company/join/requests/${id}/${approve ? "approve" : "deny"}`, { method: "POST" }),
  companyBilling: () => request("/company/billing"),
  companyPlanRequest: (plan) => request("/company/billing/plan-request", json("PUT", { plan })),
  companyProblems: (before = "") => request(`/company/problems${before ? `?before=${encodeURIComponent(before)}` : ""}`),

  // per-form sharing (same company only, enforced on the server)
  shareInfo: (id) => request(`/sharing/forms/${id}`),
  shareEligible: (id) => request(`/sharing/forms/${id}/eligible`),
  shareAdd: (id, email, role) => request(`/sharing/forms/${id}/collaborators`, json("POST", { email, role })),
  shareSetRole: (id, userId, role) => request(`/sharing/forms/${id}/collaborators/${userId}`, json("PUT", { role })),
  shareRemove: (id, userId) => request(`/sharing/forms/${id}/collaborators/${userId}`, { method: "DELETE" }),
  shareRequest: (id, role, message) => request(`/sharing/forms/${id}/request`, json("POST", { role, message })),
  shareRequests: () => request("/sharing/requests"),
  shareApprove: (id, userId, role) => request(`/sharing/forms/${id}/requests/${userId}/approve`, json("POST", { role })),
  shareDeny: (id, userId) => request(`/sharing/forms/${id}/requests/${userId}/deny`, json("POST", {})),
  teamForms: () => request("/sharing/team-forms"),

  // notifications
  testEmail: () => request("/notifications/test", { method: "POST" }),

  // response analytics + AI assistant
  analysisSummary: (formId) => request(`/analysis/${formId}/summary`),
  analysisChat: (formId, payload) => request(`/analysis/${formId}/chat`, json("POST", payload)),

  // AI token tracking
  usageMe: (days = 30) => request(`/usage/me?days=${days}`),
  usageStorage: () => request("/usage/storage"),
  companyStorageRecalc: () => request("/company/storage/recalculate", { method: "POST" }),
  usageTeam: (days = 30) => request(`/usage/team?days=${days}`),

  shareUrl: (formId) => `${window.location.origin}${window.location.pathname}#/f/${formId}`,
};
