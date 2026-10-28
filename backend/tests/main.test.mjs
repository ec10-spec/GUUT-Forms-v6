// Full backend regression suite. Run: npm test (from backend/)
import { check, suite, counts, startServer, testMongo, startSmtpSink, tokenFromMail, decodeQP, account, form } from "./helpers.mjs";
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

  suite("QA round: answer validation (P0-4)");
  const strip = (t) => t.split("\n").filter((l) => !l.startsWith("// Copy of backend") && !l.startsWith("// server enforces")).join("\n").trim();
  const beRules = fs.readFileSync(new URL("../utils/answers.js", import.meta.url), "utf8");
  const feRulesUrl = new URL("../../frontend/src/lib/answers.js", import.meta.url);
  check("form page uses the same validator as the server", !fs.existsSync(feRulesUrl) || strip(fs.readFileSync(feRulesUrl, "utf8")) === strip(beRules));
  const qa = await account(api, { type: "individual", email: "qa@x.co", password: pw, name: "Quinn" });
  const qaFields = [
    { id: "name", type: "text", label: "Your name", required: true, order: 0 },
    { id: "email", type: "email", label: "Email", required: true, order: 1 },
    { id: "rate", type: "rating", label: "Coffee rating", required: true, order: 2 },
    { id: "freq", type: "select", label: "How often", options: ["Daily", "Weekly"], order: 3 },
    { id: "drinks", type: "checkbox", label: "Drinks", options: ["Latte", "Mocha"], order: 4 },
    { id: "when", type: "date", label: "Visit date", order: 5 },
    { id: "why", type: "textarea", label: "What went wrong", order: 6, showIf: { fieldId: "rate", op: "lte", values: ["2"] } },
    { id: "cups", type: "number", label: "Cups", order: 7 },
  ];
  const qf = await api("POST", "/forms", { title: "QA coffee", fields: qaFields, generationPrompt: "secret prompt", source: "ai_generated" }, qa.token);
  check("form with rating condition saves", qf.status === 201, qf.body);
  const qid = qf.body._id;
  await api("POST", `/forms/${qid}/publish`, {}, qa.token);
  const good = { name: "Priya", email: "p@x.co", rate: 4, freq: "Daily", drinks: ["Latte"], when: "2026-10-27", cups: "2" };
  const sub = (a) => api("POST", `/submissions/${qid}`, { answers: a });
  check("valid submission accepted", (await sub(good)).status === 201);
  for (const [label, patch] of [["rating 9", { rate: 9 }], ["rating -3", { rate: -3 }], ["rating five", { rate: "five" }], ["select not an option", { freq: "Every second Tuesday" }],
    ["checkbox not an option", { drinks: ["Whiskey"] }], ["bad email", { email: "not-an-email" }], ["email of spaces", { email: "   " }], ["name of spaces", { name: "   " }],
    ["10,000 character name", { name: "x".repeat(10000) }], ["bad date", { when: "not a date" }], ["number text", { cups: "lots" }]]) {
    const r = await sub({ ...good, ...patch });
    check(`rejects ${label}`, r.status === 400 && r.body?.code === "INVALID_ANSWERS", r.body);
  }
  const hidden = await sub({ ...good, rate: 5, why: "should be dropped" });
  check("answer to a hidden question accepted but dropped", hidden.status === 201);
  const shown = await sub({ ...good, rate: 1, why: "  lukewarm  " });
  check("conditional question shown by rating <= 2", shown.status === 201);
  const qsubs = (await api("GET", `/submissions/${qid}`, undefined, qa.token)).body;
  check("hidden answer not stored, shown answer trimmed", qsubs.every((x) => x.answers.why !== "should be dropped") && qsubs.some((x) => x.answers.why === "lukewarm"), qsubs.map((x) => x.answers.why));
  check("rating stored as a number", qsubs.every((x) => typeof x.answers.rate === "number"));

  suite("QA round: analytics and dates (P0-5, P1-9, P1-10)");
  const sum = await api("GET", `/analysis/${qid}/summary?tz=America/Los_Angeles`, undefined, qa.token);
  const why = sum.body.fields?.find((x) => x.id === "why");
  check("conditional answer rate counts only responses that showed it", why?.shown === 1 && why?.answerRate === 100, why);
  const rateF = sum.body.fields?.find((x) => x.id === "rate");
  check("rating count matches its bars", rateF.answered === rateF.distribution.reduce((a, b) => a + b.count, 0), rateF);
  check("name field has no word counts", !sum.body.fields.find((x) => x.id === "name").topWords);
  check("timeline is zero-filled with a unit", sum.body.timeline?.unit === "day" && Array.isArray(sum.body.timeline.points));
  const csvTz = Buffer.from("Submitted,Your name,Email,Coffee rating\n2026-10-28T03:10:00Z,Lee,l@x.co,3\n2025-06-01,Sam,s@x.co,4\n").toString("base64");
  const impTz = await api("POST", `/submissions/${qid}/import`, { base64: csvTz, filename: "tz.csv", mapping: { name: "Your name", email: "Email", rate: "Coffee rating" }, timestampColumn: "Submitted" }, qa.token);
  check("import with timestamps", impTz.status === 201 && impTz.body.imported === 2, impTz.body);
  const sum2 = await api("GET", `/analysis/${qid}/summary?tz=America/Los_Angeles`, undefined, qa.token);
  check("8:10 PM Pacific counts on that Pacific day", sum2.body.perDay.some((d) => d.date === "2026-10-27"), sum2.body.perDay);
  check("date-only import keeps its calendar day", sum2.body.firstDay === "2025-06-01", sum2.body.firstDay);
  check("long span groups by month", sum2.body.timeline.unit === "month", sum2.body.timeline.unit);
  const csvRes = await fetch(`${S.base}/api/submissions/${qid}/export.csv?tz=America/Los_Angeles`, { headers: { Authorization: `Bearer ${qa.token}` } });
  check("CSV has a local-time column", (await csvRes.text()).startsWith("Submitted (America/Los_Angeles),Submitted (UTC)"));

  suite("QA round: import checks (P1-12)");
  const badCsv = Buffer.from("Your name,Email,Coffee rating,How often,Submitted\nAna,a@x.co,4,Weekly-ish,not a date\n,,,,\nBo,,,,2026-01-01\nCy,c@x.co,9,Daily,2026-01-02\n").toString("base64");
  const chk = await api("POST", `/submissions/${qid}/import`, { base64: badCsv, filename: "bad.csv", mapping: { name: "Your name", email: "Email", rate: "Coffee rating", freq: "How often" }, timestampColumn: "Submitted", dryRun: true }, qa.token);
  check("invalid option blanked, bad timestamp flagged", chk.body.importable === 1 && chk.body.badTimestamps === 1 && chk.body.issues.some((i) => /not one of the options/.test(i.message)), chk.body);
  check("rows missing required answers are skipped and counted", chk.body.skippedMissing === 2 && chk.body.skippedEmpty === 0, chk.body);

  suite("QA round: public form and design (P1-15, 16, 18)");
  const pub = await api("GET", `/forms/${qid}`);
  check("public form hides prompt, source and owner", pub.status === 200 && pub.body.generationPrompt === undefined && pub.body.source === undefined && pub.body.ownerId === undefined, Object.keys(pub.body));
  check("owner still sees the prompt", (await api("GET", `/forms/${qid}`, undefined, qa.token)).body.generationPrompt === "secret prompt");
  check("colour must be hex", (await api("PUT", `/forms/${qid}`, { theme: { primaryColor: "notacolor" } }, qa.token)).status === 400);
  check("embedded base64 header image rejected", (await api("PUT", `/forms/${qid}`, { theme: { primaryColor: "#001549", headerImage: "data:image/png;base64,AAAA" } }, qa.token)).body?.code === "BAD_HEADER_IMAGE");
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
  const up = await fetch(`${S.base}/api/forms/${qid}/header-image`, { method: "POST", headers: { "Content-Type": "image/png", Authorization: `Bearer ${qa.token}` }, body: png });
  const upB = await up.json();
  check("header image uploads and is stored as a URL", up.status === 201 && /^\/api\/forms\/[a-f\d]{24}\/header-image\/[a-f\d]{24}$/.test(upB.headerImage), upB);
  const img = await fetch(`${S.base}${upB.headerImage}`);
  check("header image served publicly", img.status === 200 && img.headers.get("content-type") === "image/png");
  check("saving the form keeps the uploaded image", (await api("PUT", `/forms/${qid}`, { theme: { primaryColor: "#001549", backgroundColor: "#fff8ee", headerImage: upB.headerImage } }, qa.token)).status === 200);
  const fake = await fetch(`${S.base}/api/forms/${qid}/header-image`, { method: "POST", headers: { "Content-Type": "image/png", Authorization: `Bearer ${qa.token}` }, body: Buffer.from("not an image") });
  check("non-image header rejected", fake.status === 400);
  check("logic on a text question rejected", (await api("PUT", `/forms/${qid}`, { fields: [qaFields[0], { ...qaFields[6], showIf: { fieldId: "name", op: "eq", values: ["x"] } }] }, qa.token)).status === 400);

  suite("QA round: file uploads (P0-1)");
  const ff = await api("POST", "/forms", { title: "Receipts", fields: [{ id: "who", type: "text", label: "Name", order: 0 }, { id: "receipt", type: "file", label: "Receipt", required: true, order: 1, accept: ["image"], maxSizeMb: 2 }] }, qa.token);
  const ffid = ff.body._id;
  await api("POST", `/forms/${ffid}/publish`, {}, qa.token);
  check("fake file path string rejected", (await api("POST", `/submissions/${ffid}`, { answers: { who: "Al", receipt: "C:\\fakepath\\malware.exe" } })).status === 400);
  const upl = (type, body) => fetch(`${S.base}/api/uploads/${ffid}/receipt`, { method: "POST", headers: { "Content-Type": type, "X-Filename": encodeURIComponent("receipt.png") }, body });
  const badType = await upl("text/plain", Buffer.from("hello"));
  check("file type not allowed for the question", badType.status === 400);
  const disguised = await upl("image/png", Buffer.from("MZ not really a png"));
  check("disguised file rejected", disguised.status === 400);
  const fr = await upl("image/png", png);
  const frB = await fr.json();
  check("respondent uploads a file", fr.status === 201 && !!frB.fileId, frB);
  check("submission with the uploaded file", (await api("POST", `/submissions/${ffid}`, { answers: { who: "Al", receipt: frB } })).status === 201);
  check("same file can't be attached twice", (await api("POST", `/submissions/${ffid}`, { answers: { who: "Al", receipt: frB } })).status === 400);
  const fsubs = (await api("GET", `/submissions/${ffid}`, undefined, qa.token)).body;
  const link = fsubs[0]?.answers?.receipt?.url;
  check("responses include a signed file link", !!link && fsubs[0].answers.receipt.name === "receipt.png", fsubs[0]?.answers);
  check("signed link opens the file", (await fetch(`${S.base}${link}`)).status === 200);
  check("file needs access or a signature", (await fetch(`${S.base}/api/uploads/${ffid}/${frB.fileId}`)).status === 401);

  suite("QA round: accounts (P1-6, 19, 21, 47)");
  const bq = await api("GET", "/ai/budget", undefined, qa.token);
  check("budget says AI is not ready without a key", bq.body.aiReady === false && bq.body.source === "none", bq.body);
  check("unsaved key with a bad format rejected", (await api("POST", "/ai/test", { provider: "anthropic", apiKey: "sk-wrong-key-123456" }, qa.token)).body?.code === "BAD_KEY_FORMAT");
  check("saving an OpenAI key as Claude rejected", (await api("PUT", "/auth/settings", { ai: { anthropicKey: "sk-proj-abcdefghijk" } }, qa.token)).status === 400);
  const oldToken = qa.token;
  const pwc = await api("PUT", "/auth/password", { currentPassword: pw, newPassword: "NewPassw0rd!" }, qa.token);
  check("password change returns a fresh token", pwc.status === 200 && !!pwc.body.token);
  check("old sessions are signed out after a password change", (await api("GET", "/auth/me", undefined, oldToken)).status === 401);
  check("new token works", (await api("GET", "/auth/me", undefined, pwc.body.token)).status === 200);
  check("chat list starts empty", (await api("GET", `/analysis/${qid}/chats`, undefined, pwc.body.token)).body?.length === 0);
  check("missing chat 404", (await api("GET", `/analysis/${qid}/chats/${"a".repeat(24)}`, undefined, pwc.body.token)).status === 404);
  check("others cannot list chats", (await api("GET", `/analysis/${qid}/chats`, undefined, adminB.token)).status === 403);

  const vSign = await v("POST", "/auth/signup", { type: "individual", email: "forgot@x.co", password: pw, name: "Fo" });
  await new Promise((r) => setTimeout(r, 600));
  const vtok = tokenFromMail(smtp.mails.find((m) => m.to.join().includes("forgot@x.co")));
  await v("POST", "/auth/verify", { token: vtok });
  const mailsBefore = smtp.mails.length;
  check("forgot password always answers ok", (await v("POST", "/auth/forgot", { email: "nobody-here@x.co" })).body?.ok === true && (await v("POST", "/auth/forgot", { email: "forgot@x.co" })).body?.ok === true, vSign.status);
  await new Promise((r) => setTimeout(r, 800));
  const resetMail = smtp.mails.slice(mailsBefore).find((m) => m.to.join().includes("forgot@x.co"));
  const rtok = resetMail && (decodeQP(resetMail.body).match(/reset\?token=([A-Za-z0-9_-]+)/) || [])[1];
  check("reset email carries a link", !!rtok);
  check("bad reset token rejected", (await v("POST", "/auth/reset", { token: "x".repeat(40), password: "Another1!x" })).status === 400);
  const rs = await v("POST", "/auth/reset", { token: rtok, password: "Another1!x" });
  check("reset sets the password and signs in", rs.status === 200 && !!rs.body.token, rs.body);
  check("reset link is single use", (await v("POST", "/auth/reset", { token: rtok, password: "Another2!x" })).status === 400);
  check("signs in with the new password", (await v("POST", "/auth/login", { email: "forgot@x.co", password: "Another1!x" })).status === 200);

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
