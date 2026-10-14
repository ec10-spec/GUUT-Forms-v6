// Full backend regression suite. Run: npm test (from backend/)
import { check, suite, counts, startServer, testMongo, startSmtpSink, tokenFromMail, account, form } from "./helpers.mjs";
import fs from "fs";

const stamp = Date.now().toString(36);
const mongo = await testMongo(`guut_test_${stamp}`);
const smtp = await startSmtpSink(2599);
const S = await startServer({ port: 4599, mongoUri: mongo.uri, dbSuffix: stamp, env: { INDIVIDUAL_MAX_STORAGE_MB: "0.01" } });
const V = await startServer({ port: 4598, mongoUri: mongo.uri + "v", dbSuffix: stamp + "v", env: {
  REQUIRE_EMAIL_VERIFICATION: "true", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2599", SMTP_SECURE: "false", SMTP_FROM: "GUUT <no-reply@test.local>" } });
const { api } = S;
const pw = "Passw0rd!x";

try {
  suite("health and auth basics");
  check("health ok", (await api("GET", "/health")).status === 200);
  check("plans public", Array.isArray((await api("GET", "/plans")).body?.business));
  check("bad signup type rejected", (await api("POST", "/auth/signup", { type: "x", email: "a@b.co", password: pw })).status === 400);
  check("short password rejected", (await api("POST", "/auth/signup", { type: "individual", email: "a@b.co", password: "123" })).status === 400);
  const root = await api("POST", "/auth/login", { email: "root@test.local", password: "RootPass123" });
  check("superadmin can log in", root.status === 200 && root.body.user.role === "superadmin");
  check("wrong password 401", (await api("POST", "/auth/login", { email: "root@test.local", password: "nope" })).status === 401);
  check("me requires auth", (await api("GET", "/auth/me")).status === 401);

  suite("accounts and company isolation");
  const adminA = await account(api, { type: "business", email: "admin@a.co", password: pw, name: "Ann", companyName: "Alpha Co" });
  const adminB = await account(api, { type: "business", email: "admin@b.co", password: pw, name: "Bob", companyName: "Beta Co" });
  check("business signup returns token", !!adminA.token && adminA.body.user.role === "admin");
  check("duplicate email 409", (await api("POST", "/auth/signup", { type: "individual", email: "admin@a.co", password: pw })).status === 409);
  const ind = await account(api, { type: "individual", email: "ind1@x.co", password: pw, name: "Ina" });
  const ind2 = await account(api, { type: "individual", email: "ind2@x.co", password: pw, name: "Ivo" });
  check("individual signup", ind.body?.user?.company?.type === "individual");
  const join = await api("GET", "/company/join", undefined, adminA.token);
  const code = join.body?.code;
  check("admin has join code", !!code, join.body);
  const emp = await account(api, { type: "employee", email: "emp@a.co", password: pw, name: "Eve", joinCode: code });
  check("employee starts pending", emp.body?.user?.membership?.status === "pending");
  check("bad join code 404", (await api("POST", "/auth/signup", { type: "employee", email: "e2@a.co", password: pw, joinCode: "ZZZZZZ" })).status === 404);
  check("pending cannot create forms", (await api("POST", "/forms", form(), emp.token)).status >= 400);
  const reqs = await api("GET", "/company/join", undefined, adminA.token);
  const pend = (reqs.body?.requests || [])[0];
  check("admin sees join request", !!pend, reqs.body);
  const ap = await api("POST", `/company/join/requests/${pend?._id}/approve`, {}, adminA.token);
  check("admin approves employee", ap.status === 200, ap.body);
  const empLogin = await api("POST", "/auth/login", { email: "emp@a.co", password: pw });
  check("employee active after approval", empLogin.body?.user?.membership?.status === "active" && empLogin.body.user.companyId === adminA.body.user.companyId, empLogin.body);
  emp.token = empLogin.body.token; emp.id = empLogin.body.user._id;
  check("non-admin cannot reach company admin routes", (await api("GET", "/company/users", undefined, emp.token)).status === 403);
  check("non-platform cannot create companies via admin", (await api("GET", "/admin/companies", undefined, adminA.token)).status === 403);

  suite("forms and submissions");
  const f = await api("POST", "/forms", form("Alpha form"), emp.token);
  check("employee creates form", f.status === 201, f.body);
  const fid = f.body?._id;
  check("unpublished form rejects responses", (await api("POST", `/submissions/${fid}`, { answers: { f1: "x" } })).status === 403);
  check("publish", (await api("POST", `/forms/${fid}/publish`, {}, emp.token)).status < 300);
  check("public submit ok", (await api("POST", `/submissions/${fid}`, { answers: { f1: "Zed", f2: "A" } })).status === 201);
  check("required field enforced", (await api("POST", `/submissions/${fid}`, { answers: { f2: "A" } })).status === 400);
  const subs = await api("GET", `/submissions/${fid}`, undefined, emp.token);
  check("owner lists responses", subs.status === 200 && JSON.stringify(subs.body).includes("Zed"));
  const draft = await api("POST", "/forms", form("Private draft"), emp.token);
  check("other company cannot see unpublished form", (await api("GET", `/forms/${draft.body._id}`, undefined, adminB.token)).status >= 400);
  const pdf = await fetch(`${S.base}/api/submissions/${fid}/export.pdf`, { headers: { Authorization: `Bearer ${emp.token}` } });
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  check("owner exports responses as PDF", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdfBuf.slice(0, 4).toString() === "%PDF", pdf.status);
  const pdf2 = await fetch(`${S.base}/api/submissions/${fid}/export.pdf`, { headers: { Authorization: `Bearer ${adminB.token}` } });
  check("other company cannot export PDF", pdf2.status >= 400);
  const csv = await fetch(`${S.base}/api/submissions/${fid}/export.csv`, { headers: { Authorization: `Bearer ${emp.token}` } });
  check("owner exports CSV", csv.status === 200 && (await csv.text()).includes("Zed"));
  check("other company cannot list responses", (await api("GET", `/submissions/${fid}`, undefined, adminB.token)).status >= 400);
  check("other company cannot delete form", (await api("DELETE", `/forms/${fid}`, undefined, adminB.token)).status >= 400);
  check("individual cannot read business responses", (await api("GET", `/submissions/${fid}`, undefined, ind.token)).status >= 400);

  suite("sharing and permissions");
  const colleague = await api("POST", "/company/users", { email: "col@a.co", name: "Cole", password: pw, role: "user" }, adminA.token);
  check("admin creates a user", colleague.status === 201, colleague.body);
  const colLogin = await api("POST", "/auth/login", { email: "col@a.co", password: pw });
  const col = { token: colLogin.body?.token };
  check("stranger has no access to form", (await api("PUT", `/forms/${fid}`, { title: "hack" }, col.token)).status >= 400);
  check("share with same-company viewer", (await api("POST", `/sharing/forms/${fid}/collaborators`, { email: "col@a.co", role: "viewer" }, emp.token)).status === 201);
  check("viewer cannot edit", (await api("PUT", `/forms/${fid}`, { title: "hack" }, col.token)).status >= 400);
  check("upgrade to editor", (await api("POST", `/sharing/forms/${fid}/collaborators`, { email: "col@a.co", role: "editor" }, emp.token)).status === 201);
  check("editor can edit", (await api("PUT", `/forms/${fid}`, { title: "Renamed" }, col.token)).status === 200);
  check("editor cannot delete", (await api("DELETE", `/forms/${fid}`, undefined, col.token)).status >= 400);
  check("cannot share to other company email", (await api("POST", `/sharing/forms/${fid}/collaborators`, { email: "admin@b.co", role: "viewer" }, emp.token)).status === 404);
  const indForm = await api("POST", "/forms", form("Mine"), ind.token);
  check("individual creates form", indForm.status === 201);
  check("individual shares with another individual", (await api("POST", `/sharing/forms/${indForm.body._id}/collaborators`, { email: "ind2@x.co", role: "viewer" }, ind.token)).status === 201);
  check("individual can share with any account", (await api("POST", `/sharing/forms/${indForm.body._id}/collaborators`, { email: "col@a.co", role: "viewer" }, ind.token)).status === 201);
  check("shared individual sees the form", JSON.stringify((await api("GET", "/forms", undefined, ind2.token)).body).includes("Mine"));

  suite("teams");
  const t = await api("POST", "/teams", { name: "Sales" }, emp.token);
  check("any member creates a team", t.status === 201, t.body);
  check("duplicate team name rejected", (await api("POST", "/teams", { name: "sales" }, col.token)).status >= 400);
  check("individual can create an open team", (await api("POST", "/teams", { name: "Friends" }, ind.token)).status === 201);
  check("add member from own company", (await api("POST", `/teams/${t.body._id}/members`, { email: "col@a.co" }, emp.token)).status === 201);
  check("cannot add other company member", (await api("POST", `/teams/${t.body._id}/members`, { email: "admin@b.co" }, emp.token)).status === 404);
  check("non-manager cannot add members", (await api("POST", `/teams/${t.body._id}/members`, { email: "emp@a.co" }, col.token)).status >= 400);
  const f2 = await api("POST", "/forms", form("Team form"), emp.token);
  check("share form with team", (await api("POST", `/sharing/forms/${f2.body._id}/teams`, { teamId: t.body._id, role: "viewer" }, emp.token)).status === 201);
  check("team member sees form", JSON.stringify((await api("GET", "/forms", undefined, col.token)).body).includes("Team form"));
  check("other company cannot see team", (await api("GET", "/teams", undefined, adminB.token)).body?.length === 0);

  suite("storage cap and usage");
  let cap = null;
  for (let i = 0; i < 40 && !cap; i++) {
    const r = await api("POST", "/forms", { title: "Big " + i, description: "x".repeat(900), fields: form().fields }, ind.token);
    if (r.status === 402) cap = r;
  }
  check("individual storage cap enforced (402 STORAGE_LIMIT)", cap?.body?.code === "STORAGE_LIMIT", cap?.body);
  const st = await api("GET", "/usage/storage", undefined, ind.token);
  check("storage usage endpoint", st.status === 200, st.body);
  check("token usage endpoint", (await api("GET", "/usage/me", undefined, emp.token)).status === 200);
  check("team usage admin only", (await api("GET", "/usage/team", undefined, emp.token)).status === 403);
  check("admin sees team usage", (await api("GET", "/usage/team", undefined, adminA.token)).status === 200);

  suite("email verification");
  const v = V.api;
  const before = smtp.mails.length;
  const su = await v("POST", "/auth/signup", { type: "individual", email: "newbie@x.co", password: pw, name: "New" });
  check("signup needs verification", su.status === 201 && su.body.needsVerification === true, su.body);
  check("unverified cannot log in", (await v("POST", "/auth/login", { email: "newbie@x.co", password: pw })).body?.code === "EMAIL_NOT_VERIFIED");
  await new Promise((r) => setTimeout(r, 800));
  const mail = smtp.mails.slice(before).find((m) => m.to.join().includes("newbie@x.co"));
  const tok = mail && tokenFromMail(mail);
  check("verification email sent with link", !!tok);
  check("bad token rejected", (await v("POST", "/auth/verify", { token: "x".repeat(40) })).status === 400);
  const ok = await v("POST", "/auth/verify", { token: tok });
  check("valid token verifies and signs in", ok.status === 200 && !!ok.body.token, ok.body);
  check("token is single use", (await v("POST", "/auth/verify", { token: tok })).status === 400);
  check("verified user can log in", (await v("POST", "/auth/login", { email: "newbie@x.co", password: pw })).status === 200);

  suite("v11: open teams, join link, approvals, import, copy rules");
  const own3 = await account(api, { type: "individual", email: "own3@x.co", password: pw, name: "Olu" });
  await api("POST", "/teams", { name: "Friends" }, own3.token);
  const friends = (await api("GET", "/teams", undefined, own3.token)).body.find((x) => x.name === "Friends");
  check("open team is marked open", friends?.open === true, friends);
  check("open team adds any account by email", (await api("POST", `/teams/${friends._id}/members`, { email: "ind2@x.co" }, own3.token)).status === 201);
  check("unknown email rejected for open team", (await api("POST", `/teams/${friends._id}/members`, { email: "nobody@x.co" }, own3.token)).status === 404);
  const indForm2 = await api("POST", "/forms", form("Club form"), own3.token);
  const shT = await api("POST", `/sharing/forms/${indForm2.body._id}/teams`, { teamId: friends._id, role: "viewer" }, own3.token);
  check("individual shares form with open team", shT.status === 201, [indForm2.status, shT.body]);
  check("team member sees the form", JSON.stringify((await api("GET", "/forms", undefined, ind2.token)).body).includes("Club form"));
  check("team viewer cannot edit", (await api("PUT", `/forms/${indForm2.body._id}`, { title: "x" }, ind2.token)).status >= 400);

  const info = await api("GET", `/auth/join-info?code=${code}`);
  check("join link shows company name", info.status === 200 && info.body.companyName === "Alpha Co", info.body);
  check("bad join link 404", (await api("GET", "/auth/join-info?code=ZZZZZZZZ")).status === 404);
  check("request-join needs sign in", (await api("POST", "/auth/request-join", { joinCode: code })).status === 401);
  const joiner = await account(api, { type: "individual", email: "joiner@x.co", password: pw, name: "Jo" });
  const rj = await api("POST", "/auth/request-join", { joinCode: code }, joiner.token);
  check("signed in person requests to join", rj.status === 200 && rj.body.user.membership.status === "pending", rj.body);
  const ap1 = await api("GET", "/company/approvals", undefined, adminA.token);
  const jr = ap1.body.joins.find((j) => j.email === "joiner@x.co");
  check("approvals lists the join request", !!jr, ap1.body);
  check("non-admin cannot see approvals", (await api("GET", "/company/approvals", undefined, emp.token)).status === 403);
  check("admin approves join", (await api("POST", `/company/join/requests/${jr._id}/approve`, {}, adminA.token)).status === 200);
  const jl = await api("POST", "/auth/login", { email: "joiner@x.co", password: pw });
  check("joiner is now in the company", jl.body.user.companyId === adminA.body.user.companyId, jl.body.user);

  const lst = await api("PUT", `/forms/${fid}`, { isPublic: true }, emp.token);
  check("business member listing waits for approval", lst.status === 200 && lst.body.isPublic === false && lst.body.listingStatus === "pending", lst.body);
  check("not listed publicly yet", !JSON.stringify((await api("GET", "/forms/public")).body).includes(fid));
  const ap2 = await api("GET", "/company/approvals", undefined, adminA.token);
  check("approvals lists the form", ap2.body.listings.some((l) => l.formId === fid), ap2.body);
  check("member cannot approve own listing", (await api("POST", `/company/listings/${fid}/approve`, {}, emp.token)).status === 403);
  check("admin approves listing", (await api("POST", `/company/listings/${fid}/approve`, {}, adminA.token)).status === 200);
  check("form now listed publicly", JSON.stringify((await api("GET", "/forms/public")).body).includes(fid));

  const csvText = "Submitted,Name,Pick\n2024-01-05,Old Ann,A\n2024-02-06,Old Bob,B\n,,\n";
  const b64 = Buffer.from(csvText).toString("base64");
  const prev = await api("POST", `/submissions/${fid}/import/preview`, { base64: b64, filename: "old.csv" }, emp.token);
  check("import preview maps columns", prev.status === 200 && prev.body.mapping.f1 === "Name" && prev.body.mapping.f2 === "Pick" && prev.body.timestampColumn === "Submitted", prev.body);
  const dry = await api("POST", `/submissions/${fid}/import`, { base64: b64, filename: "old.csv", mapping: prev.body.mapping, timestampColumn: "Submitted", dryRun: true }, emp.token);
  check("dry run imports nothing", dry.status === 200 && dry.body.importable === 2, dry.body);
  const nBefore = (await api("GET", `/submissions/${fid}`, undefined, emp.token)).body.length;
  const imp = await api("POST", `/submissions/${fid}/import`, { base64: b64, filename: "old.csv", mapping: prev.body.mapping, timestampColumn: "Submitted" }, emp.token);
  check("import adds responses", imp.status === 201 && imp.body.imported === 2, imp.body);
  check("responses now include imported rows", (await api("GET", `/submissions/${fid}`, undefined, emp.token)).body.length === nBefore + 2 && JSON.stringify((await api("GET", `/submissions/${fid}`, undefined, emp.token)).body).includes("Old Ann"));
  check("stranger cannot import", (await api("POST", `/submissions/${fid}/import`, { base64: b64, filename: "old.csv", mapping: prev.body.mapping }, adminB.token)).status >= 400);

  const x = await api("POST", "/company/users", { email: "x@a.co", name: "Xan", password: pw, role: "user" }, adminA.token);
  const xl = await api("POST", "/auth/login", { email: "x@a.co", password: pw });
  check("same-company member cannot copy a private form", (await api("POST", `/forms/${draft.body._id}/duplicate`, {}, xl.body.token)).status === 403);
  await api("POST", `/sharing/forms/${draft.body._id}/collaborators`, { email: "x@a.co", role: "viewer" }, emp.token);
  check("viewer can copy but not edit", (await api("POST", `/forms/${draft.body._id}/duplicate`, {}, xl.body.token)).status === 201 && (await api("PUT", `/forms/${draft.body._id}`, { title: "no" }, xl.body.token)).status >= 400);
  check("viewer cannot republish", (await api("POST", `/forms/${draft.body._id}/publish`, {}, xl.body.token)).status >= 400);

  check("business public form hides GUUT branding", (await api("GET", `/forms/${fid}`)).body.hideBranding === true);
  const pubInd = await api("POST", "/forms", form("Free form"), own3.token);
  await api("POST", `/forms/${pubInd.body._id}/publish`, {}, own3.token);
  check("free public form keeps GUUT branding", (await api("GET", `/forms/${pubInd.body._id}`)).body.hideBranding === false);

  check("platform team can create a team", (await api("POST", "/teams", { name: "Platform ops" }, root.body.token)).status === 201);

  const gen = await api("POST", "/ai/generate-form", { prompt: "a survey" }, ind.token);
  check("no key and no platform key asks for a key", gen.status === 400 && gen.body.code === "NO_API_KEY", gen.body);
  const bud = await api("GET", "/ai/budget", undefined, ind.token);
  check("budget reports credit unavailable without platform key", bud.status === 200 && bud.body.credit?.available === false, bud.body);

  suite("platform admin");
  check("platform lists companies", (await api("GET", "/admin/companies", undefined, root.body.token)).status === 200);
} catch (e) {
  console.log("  FAIL suite crashed:", e.stack);
  counts().failures.push("crash: " + e.message);
} finally {
  S.stop(); V.stop(); smtp.close(); await mongo.stop();
}

const { passed, failed, failures } = counts();
console.log(`\nResult: ${passed} passed, ${failed} failed`);
const record = { at: new Date().toISOString(), passed, failed, failures, node: process.version, commit: process.env.GITHUB_SHA || process.env.RENDER_GIT_COMMIT || null };
try {
  const file = new URL("./results.json", import.meta.url);
  const hist = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  hist.push(record);
  fs.writeFileSync(file, JSON.stringify(hist.slice(-50), null, 2));
} catch {}
process.exit(failed || !passed ? 1 : 0);
