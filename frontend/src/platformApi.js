// Platform-team (superadmin) API calls. Kept in their own file so the code is
// only ever downloaded by the platform team: it is loaded together with the
// lazy PlatformAdmin screen, never in the main bundle. Every endpoint is also
// enforced server-side (requireSuperadmin); this split is defence in depth.
import { request, json } from "./api.js";

export const platformApi = {
  adminOverview: () => request("/admin/overview"),
  adminCompanies: (type = "business", q = "") => request(`/admin/companies?type=${type}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  adminRecalcStorage: (id) => request(`/admin/companies/${id}/recalculate-storage`, { method: "POST" }),
  adminSetBilling: (id, payload) => request(`/admin/companies/${id}/billing`, json("PUT", payload)),
  adminCreateCompany: (payload) => request("/admin/companies", json("POST", payload)),
  adminRenameCompany: (id, name) => request(`/admin/companies/${id}`, json("PUT", { name })),
  adminTestDb: (uri) => request("/admin/database/test", json("POST", { uri })),
  adminLinkDb: (id, uri, migrate) => request(`/admin/companies/${id}/database`, json("PUT", { uri, migrate })),
  adminUnlinkDb: (id, migrate) => request(`/admin/companies/${id}/database?migrate=${!!migrate}`, { method: "DELETE" }),
  adminCheckDb: (id) => request(`/admin/companies/${id}/database/check`, { method: "POST" }),
  adminUsers: () => request("/admin/users"),
  adminCreateUser: (payload) => request("/admin/users", json("POST", payload)),
  adminUpdateUser: (id, payload) => request(`/admin/users/${id}`, json("PUT", payload)),
  adminLogs: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/admin/logs${qs ? `?${qs}` : ""}`);
  },
  adminLog: (id) => request(`/admin/logs/${id}`),
  adminUsage: (days = 30) => request(`/admin/usage?days=${days}`),

};
