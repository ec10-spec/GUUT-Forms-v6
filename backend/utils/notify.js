import User from "../models/User.js";
import mongoose from "mongoose";
import FormIndex from "../models/FormIndex.js";
import Team from "../models/Team.js";
import NotifyState from "../models/NotifyState.js";
import { tenantForCompanyId } from "../middleware/auth.js";
import { sendMail, renderEmail, mailEnabled, appUrl } from "./mailer.js";
import { logger } from "./logger.js";

// Every function here is best-effort and NEVER throws: a notification problem
// must not break form creation, submissions or sharing. Emails carry counts and
// links only, never response content.

const link = (formId) => `${appUrl()}/#/edit/${formId}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function titleOf(idx) {
  try {
    const tenant = await tenantForCompanyId(idx.companyId);
    return (await tenant.Form.findById(idx._id).select("title").lean())?.title || null;
  } catch {
    return null;
  }
}

const safe = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { logger.warn("system", `Notification error: ${String(err.message).slice(0, 200)}`); }
};

/** A form was created: tell the company's admins (not the creator). */
export const notifyFormCreated = safe(async ({ form, companyId, creator }) => {
  if (!mailEnabled()) return;
  const admins = await User.find({
    companyId, role: "admin", active: true, _id: { $ne: creator._id },
    "notifications.formCreated": { $ne: false },
  }).select("email");
  const who = creator.name || creator.email;
  for (const a of admins) {
    const { text, html } = renderEmail({
      heading: "A new form was created",
      lines: [`${who} created the form "${form.title}" in your company.`],
      cta: "Open form", url: link(form._id),
    });
    await sendMail({ to: a.email, subject: `New form created: ${form.title}`, text, html });
  }
});

async function sendResponseEmail(idx, owner, count) {
  const title = (await titleOf(idx)) || "your form";
  const lines = count === 1
    ? [`You have 1 new response on "${title}".`]
    : [`You have ${count} new responses on "${title}" since your last update.`];
  lines.push("Open the form and go to the Responses tab to review them.");
  const { text, html } = renderEmail({ heading: count === 1 ? "You have a new response" : "You have new responses", lines, cta: "View responses", url: link(idx._id) });
  await sendMail({ to: owner.email, subject: `You have ${plural(count, "new response")} on "${title}"`, text, html });
}

/** Atomically takes the pending count (so two workers never send twice), then emails it. */
async function flush(state, owner) {
  const claimed = await NotifyState.findOneAndUpdate(
    { _id: state._id, pendingCount: { $gt: 0 } },
    { $set: { pendingCount: 0, firstPendingAt: null, lastSentAt: new Date() } },
    { new: false }
  );
  if (!claimed) return;
  const idx = await FormIndex.findById(state.formId);
  if (!idx) return;
  try {
    await sendResponseEmail(idx, owner, claimed.pendingCount);
  } catch (err) {
    // Put the count back so the next pass retries instead of losing it.
    await NotifyState.updateOne({ _id: state._id }, { $inc: { pendingCount: claimed.pendingCount }, $set: { firstPendingAt: claimed.firstPendingAt || new Date() } });
    throw err;
  }
}

/** Everyone who should hear about a response: the creator, plus people the form is shared with who opted in. */
async function recipientsOf(idx) {
  const ids = new Set([idx.ownerId]);
  const shared = new Set((idx.collaborators || []).map((c) => c.userId));
  const teamIds = (idx.teamShares || []).map((t) => t.teamId).filter((t) => mongoose.isValidObjectId(t));
  if (teamIds.length) for (const t of await Team.find({ _id: { $in: teamIds } }).select("members.userId")) for (const m of t.members) shared.add(m.userId);
  const optedIn = shared.size
    ? await User.find({ _id: { $in: [...shared].filter((x) => mongoose.isValidObjectId(x)) }, active: true, "notifications.sharedResponses": true })
    : [];
  const out = [];
  const owner = await User.findById(idx.ownerId);
  if (owner?.active) out.push(owner);
  for (const u of optedIn) if (String(u._id) !== String(idx.ownerId)) out.push(u);
  return out;
}

async function notifyOne(idx, person) {
  const r = person.notifications?.responses || {};
  if (r.enabled === false) return;
  const mode = r.mode || "every";
  if (mode === "every") return sendResponseEmail(idx, person, 1);

  const state = await NotifyState.findOneAndUpdate(
    { formId: idx._id, ownerId: String(person._id) },
    { $inc: { pendingCount: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!state.firstPendingAt) {
    await NotifyState.updateOne({ _id: state._id, firstPendingAt: null }, { $set: { firstPendingAt: new Date() } });
    state.firstPendingAt = new Date();
  }
  if (mode === "count" && state.pendingCount >= (r.count || 10)) await flush(state, person);
  // "hours" mode is picked up by the scheduler below.
}

/** A response arrived: notify the form's creator, and anyone it is shared with who turned that on, per THEIR settings. */
export const notifyResponse = safe(async (idx) => {
  if (!mailEnabled()) return;
  for (const person of await recipientsOf(idx)) {
    try { await notifyOne(idx, person); } catch (err) { logger.warn("system", `Notification error: ${String(err.message).slice(0, 200)}`); }
  }
});

/** Looks at everything waiting and sends what is due under each creator's CURRENT settings. */
let running = false;
export async function flushDue() {
  if (running || !mailEnabled()) return;
  running = true;
  try {
    const waiting = await NotifyState.find({ pendingCount: { $gt: 0 } }).limit(500);
    for (const st of waiting) {
      try {
        const owner = await User.findById(st.ownerId);
        const r = owner?.notifications?.responses || {};
        if (!owner || !owner.active || r.enabled === false) { await st.deleteOne(); continue; }
        const mode = r.mode || "every";
        const waitedMs = st.firstPendingAt ? Date.now() - st.firstPendingAt.getTime() : 0;
        const due =
          mode === "every" ||
          (mode === "count" && st.pendingCount >= (r.count || 10)) ||
          (mode === "hours" && st.firstPendingAt && waitedMs >= (r.hours || 24) * 3600 * 1000);
        if (due) await flush(st, owner);
      } catch (err) {
        logger.warn("system", `Digest send failed: ${String(err.message).slice(0, 200)}`);
      }
    }
  } finally {
    running = false;
  }
}

export function startNotificationScheduler() {
  if (!mailEnabled()) {
    console.log("Email notifications are off (set SMTP_HOST and SMTP_FROM to enable them).");
    return;
  }
  setInterval(() => flushDue().catch(() => {}), 60 * 1000).unref();
  console.log("Email notifications on (digest check every minute).");
}

/** A teammate asked for access: tell the form's owner (or the company admins if the owner is gone). */
export const notifyAccessRequest = safe(async ({ idx, requester, role, message }) => {
  if (!mailEnabled()) return;
  let people = [];
  const owner = await User.findById(idx.ownerId);
  if (owner?.active) people = [owner];
  else people = await User.find({ companyId: idx.companyId, role: "admin", active: true });
  people = people.filter((p) => p.notifications?.accessRequests !== false && String(p._id) !== String(requester._id));
  const title = (await titleOf(idx)) || "a form";
  const who = requester.name || requester.email;
  for (const p of people) {
    const { text, html } = renderEmail({
      heading: "Someone asked for access to your form",
      lines: [`${who} (${requester.email}) asked for ${role === "editor" ? "edit" : "view"} access to "${title}".`, ...(message ? [`Message: ${message}`] : []), "Open the form, choose Share, and approve or decline the request."],
      cta: "Review request", url: link(idx._id),
    });
    await sendMail({ to: p.email, subject: `${who} requested access to "${title}"`, text, html });
  }
});

/** The requester hears the outcome; also used when an owner grants access directly. */
export const notifyAccessDecision = safe(async ({ idx, user, outcome, role }) => {
  if (!mailEnabled()) return;
  const title = (await titleOf(idx)) || "a form";
  const granted = outcome === "granted";
  const { text, html } = renderEmail({
    heading: granted ? "You now have access to a form" : "Your access request was declined",
    lines: [granted ? `You can now ${role === "editor" ? "edit" : "view"} "${title}".` : `Your request for access to "${title}" was declined.`],
    ...(granted ? { cta: "Open form", url: link(idx._id) } : {}),
  });
  await sendMail({ to: user.email, subject: granted ? `You now have ${role === "editor" ? "edit" : "view"} access to "${title}"` : `Access request declined: "${title}"`, text, html });
});

/** An employee asked to join a business: tell its admins. */
export const notifyJoinRequest = safe(async ({ company, requester }) => {
  if (!mailEnabled()) return;
  const admins = await User.find({ companyId: company._id, role: "admin", active: true, "notifications.accessRequests": { $ne: false } }).select("email");
  const who = requester.name || requester.email;
  for (const a of admins) {
    const { text, html } = renderEmail({
      heading: "Someone wants to join your company",
      lines: [`${who} (${requester.email}) signed up with your company code and is waiting for your approval.`, "Open Admin > Team to approve or decline."],
      cta: "Review request", url: `${appUrl()}/#/admin`,
    });
    await sendMail({ to: a.email, subject: `${who} asked to join ${company.name}`, text, html });
  }
});

/** The employee hears the outcome. */
export const notifyJoinDecision = safe(async ({ company, user, approved }) => {
  if (!mailEnabled()) return;
  const { text, html } = renderEmail({
    heading: approved ? `You're in: welcome to ${company.name}` : "Your request to join was declined",
    lines: [approved ? `A company admin approved your account. You can now build and share forms with ${company.name}.` : `${company.name} declined your request. You can keep using GUUT Forms as an individual.`],
    cta: "Open GUUT Forms", url: appUrl(),
  });
  await sendMail({ to: user.email, subject: approved ? `You've been approved at ${company.name}` : `Your request to join ${company.name} was declined`, text, html });
});

/** Someone was added to a team: tell them (open teams can include people from other accounts). */
export const notifyTeamAdded = safe(async ({ team, user, addedBy }) => {
  if (!mailEnabled()) return;
  const who = addedBy.name || addedBy.email;
  const { text, html } = renderEmail({
    heading: `You were added to the team "${team.name}"`,
    lines: [`${who} added you to the team "${team.name}". You will see forms that are shared with the team under Forms. You can leave the team at any time from the Teams page.`],
    cta: "Open Teams", url: `${appUrl()}/#/teams`,
  });
  await sendMail({ to: user.email, subject: `${who} added you to "${team.name}"`, text, html });
});

/** A teammate asked for a form to be listed publicly: tell the company's admins. */
export const notifyListingRequest = safe(async ({ company, requester, title }) => {
  if (!mailEnabled()) return;
  const admins = await User.find({ companyId: company._id, role: "admin", active: true, "notifications.accessRequests": { $ne: false } }).select("email");
  const who = requester.name || requester.email;
  for (const a of admins) {
    const { text, html } = renderEmail({
      heading: "A form needs approval to be listed publicly",
      lines: [`${who} asked to list "${title}" in the public repository.`, "Open Approvals to approve or decline."],
      cta: "Review request", url: `${appUrl()}/#/approvals`,
    });
    await sendMail({ to: a.email, subject: `Approval needed: "${title}" public listing`, text, html });
  }
});

export const notifyListingDecision = safe(async ({ user, title, approved }) => {
  if (!mailEnabled()) return;
  const { text, html } = renderEmail({
    heading: approved ? "Your form is now listed publicly" : "Your public listing request was declined",
    lines: [approved ? `"${title}" is now listed in the public repository.` : `A company admin declined listing "${title}" in the public repository. It is still available to the people you shared it with.`],
    cta: "Open GUUT Forms", url: appUrl(),
  });
  await sendMail({ to: user.email, subject: approved ? `"${title}" is now public` : `Public listing declined: "${title}"`, text, html });
});
