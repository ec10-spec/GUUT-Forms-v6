import { validateValue, visibleFieldIds, conditionOf, isEmpty, isNameLike } from "./answers.js";
import { dayKey, bucketSeries, safeTz } from "./time.js";

// Turns a form's raw responses into aggregates: counts, distributions, simple
// statistics and a timeline. Used by the charts AND (by default) as the only
// data the AI assistant sees, so respondents' individual answers stay private.

const STOP = new Set(("a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our she so that the their them then there these they this to too us was we were what when which who will with would you your yes also can just very more most than about all any been being do does did how out up " +
  "get got its it's i'm im ive i've dont don't didnt didn't cant can't wont won't isnt isn't was wasnt one two some much many really quite bit lot lots thing things like well good okay ok etc nbsp amp quot gt lt br div span").split(/\s+/).filter(Boolean));

const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);
const pct = (n, of) => (of ? round((n / of) * 100, 1) : 0);
// Strips HTML tags and entities so pasted markup never shows up as "words".
const plainText = (s) => String(s).replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");

function median(sorted) {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function histogram(nums, buckets = 8) {
  const min = Math.min(...nums), max = Math.max(...nums);
  if (min === max) return [{ label: String(round(min)), count: nums.length }];
  const n = Math.min(buckets, Math.max(3, Math.ceil(Math.sqrt(nums.length))));
  const step = (max - min) / n;
  const bins = Array.from({ length: n }, (_, i) => ({ from: min + i * step, to: min + (i + 1) * step, count: 0 }));
  for (const x of nums) bins[Math.min(n - 1, Math.floor((x - min) / step))].count++;
  return bins.map((b) => ({ label: `${round(b.from, 1)} to ${round(b.to, 1)}`, count: b.count }));
}

/**
 * Summary of one question. Only rows where the question was SHOWN count toward its answer rate (a
 * conditional question isn't "skipped" by people who never saw it). Values that fail the shared validator
 * (from before validation existed) are counted as invalid and left out of every statistic.
 */
function summarizeField(f, rows, visibleRows) {
  const shownRows = rows.filter((r) => visibleRows.get(r)?.has(f.id));
  const checked = shownRows.map((r) => r.answers?.[f.id]).filter((v) => !isEmpty(v)).map((v) => ({ raw: v, ...validateValue(f, v) }));
  const valid = checked.filter((c) => !c.error && !isEmpty(c.value)).map((c) => c.value);
  const invalid = checked.length - valid.length;
  const base = {
    id: f.id, label: f.label, type: f.type, required: !!f.required, conditional: !!conditionOf(f),
    shown: shownRows.length, answered: valid.length, invalid, skipped: shownRows.length - checked.length,
    answerRate: pct(valid.length, shownRows.length),
  };
  if (!valid.length) return base;
  const vals = valid;

  if (f.type === "select" || f.type === "checkbox") {
    const counts = new Map((f.options || []).map((o) => [o, 0]));
    for (const v of vals) for (const x of Array.isArray(v) ? v : [v]) counts.set(x, (counts.get(x) || 0) + 1);
    const choices = [...counts].map(([label, count]) => ({ label, count, pct: pct(count, vals.length) }));
    if (invalid) choices.push({ label: "Invalid", count: invalid, pct: pct(invalid, checked.length), invalid: true });
    const top = [...choices].filter((c) => !c.invalid).sort((a, b) => b.count - a.count)[0];
    return { ...base, choices, top: top && top.count ? { label: top.label, count: top.count } : null };
  }
  if (f.type === "rating") {
    const dist = [1, 2, 3, 4, 5].map((n) => ({ label: `${n}`, count: vals.filter((x) => x === n).length }));
    return { ...base, average: round(vals.reduce((a, b) => a + b, 0) / vals.length), distribution: dist };
  }
  if (f.type === "number") {
    const nums = [...vals].sort((a, b) => a - b);
    return { ...base, min: round(nums[0]), max: round(nums[nums.length - 1]), mean: round(nums.reduce((a, b) => a + b, 0) / nums.length), median: round(median(nums)), histogram: histogram(nums) };
  }
  if (f.type === "date") {
    const ds = [...vals].sort();
    const byDay = new Map();
    for (const d of ds) byDay.set(d, (byDay.get(d) || 0) + 1);
    const { unit, points } = bucketSeries(byDay);
    return { ...base, earliest: ds[0], latest: ds[ds.length - 1], seriesUnit: unit, series: points.map((p) => ({ label: p.date, count: p.count })) };
  }
  if (f.type === "email") {
    const m = new Map();
    for (const v of vals) { const d = String(v).split("@")[1]?.toLowerCase(); if (d) m.set(d, (m.get(d) || 0) + 1); }
    return { ...base, topDomains: [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count })) };
  }
  if (f.type === "text" || f.type === "textarea") {
    const len = vals.reduce((a, v) => a + String(v).length, 0);
    const out = { ...base, avgLength: Math.round(len / vals.length) };
    // Names, phone numbers and addresses aren't themes: no word counts for them.
    if (isNameLike(f)) return { ...out, nameLike: true };
    const words = new Map();
    for (const v of vals) {
      const seen = new Set();
      for (const w of plainText(v).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
        if (STOP.has(w) || seen.has(w)) continue;
        seen.add(w);
        words.set(w, (words.get(w) || 0) + 1);
      }
    }
    return { ...out, topWords: [...words].filter(([, c]) => c > 1 || vals.length < 20).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, count]) => ({ label, count })) };
  }
  return base; // file: only the answered count
}

/** tz: the viewer's IANA time zone; days are grouped in it. */
export function buildSummary(form, rows, { tz = "UTC" } = {}) {
  const zone = safeTz(tz);
  const fields = [...(form.fields || [])].sort((a, b) => a.order - b.order);
  const byDay = new Map();
  for (const r of rows) {
    const k = dayKey(r.createdAt, zone);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const perDay = [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count }));
  const { unit, points } = bucketSeries(byDay);
  const visibleRows = new Map(rows.map((r) => [r, visibleFieldIds(fields, r.answers || {})]));
  const times = rows.map((r) => +new Date(r.createdAt));
  const summaries = fields.map((f) => summarizeField(f, rows, visibleRows));
  const rated = summaries.filter((s) => s.shown > 0);
  return {
    total: rows.length,
    imported: rows.filter((r) => r.imported).length,
    timeZone: zone,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    firstDay: perDay[0]?.date || null,
    lastDay: perDay[perDay.length - 1]?.date || null,
    // Average over questions, each counted only over the responses where it was shown.
    avgAnswerRate: rated.length ? round(rated.reduce((a, s) => a + s.answerRate, 0) / rated.length, 1) : 0,
    invalidValues: summaries.reduce((a, s) => a + (s.invalid || 0), 0),
    perDay,
    timeline: { unit, points },
    fields: summaries,
  };
}

const AI_RAW_TYPES = new Set(["text", "textarea", "select", "checkbox", "rating", "number", "date"]);

/**
 * What the AI is allowed to see. Default: aggregates only. With includeRaw, also a
 * capped sample of recent answers, never email or file fields.
 */
export function buildAiContext(form, summary, rows, includeRaw) {
  const notes = [
    "answerRate counts only responses where the question was shown; conditional questions are hidden from people whose earlier answers didn't meet the condition, so a low 'shown' count is expected and is not a completion problem.",
    "'invalid' counts stored values that fail validation (for example a rating outside 1 to 5, or a choice that is not one of the options). They come from before validation existed or from an import, and are excluded from averages and charts.",
    `Dates are grouped in the viewer's time zone (${summary.timeZone}).`,
  ];
  const ctx = {
    form: { title: form.title, description: form.description || "", fieldCount: (form.fields || []).length },
    responses: { total: summary.total, imported: summary.imported, firstDay: summary.firstDay, lastDay: summary.lastDay, avgAnswerRate: summary.avgAnswerRate, perDayRecent: summary.perDay.slice(-45) },
    notes,
    // Word counts from free text are only shared when the person chose to share answers; never for name-like questions.
    fields: summary.fields.map(({ topDomains, topWords, nameLike, ...rest }) => {
      if (rest.type === "email") return { ...rest, note: "email addresses withheld" };
      if (topWords && includeRaw && !nameLike) return { ...rest, topWords };
      if (rest.type === "text" || rest.type === "textarea") return { ...rest, note: nameLike ? "names or contact details withheld" : "free-text words withheld unless answers are shared" };
      return rest;
    }),
  };
  if (includeRaw) {
    const fields = [...(form.fields || [])].sort((a, b) => a.order - b.order).filter((f) => AI_RAW_TYPES.has(f.type) && !isNameLike(f));
    const sample = [];
    let chars = 0;
    for (const r of [...rows].reverse().slice(0, 150)) {
      const answers = {};
      for (const f of fields) {
        const { value: v0, error } = validateValue(f, r.answers?.[f.id]);
        if (error || isEmpty(v0)) continue;
        let v = v0;
        v = Array.isArray(v) ? v.join(", ") : String(v);
        answers[f.label] = v.length > 300 ? `${v.slice(0, 300)}...` : v;
      }
      const size = JSON.stringify(answers).length;
      if (chars + size > 40000) break;
      chars += size;
      sample.push({ at: new Date(r.createdAt).toISOString().slice(0, 10), answers });
    }
    ctx.sampleOfRecentResponses = { note: `Most recent ${sample.length} of ${summary.total} responses. Email, file and name or contact questions are excluded.`, responses: sample };
  }
  return ctx;
}
