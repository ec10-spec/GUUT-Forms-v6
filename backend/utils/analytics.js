// Turns a form's raw responses into aggregates: counts, distributions, simple
// statistics and a timeline. Used by the charts AND (by default) as the only
// data the AI assistant sees, so respondents' individual answers stay private.

const STOP = new Set(("a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our she so that the their them then there these they this to too us was we were what when which who will with would you your yes also can just very more most than about all any been being do does did how out up").split(" "));

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);
const pct = (n, of) => (of ? round((n / of) * 100, 1) : 0);
const asList = (v) => (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);

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

function summarizeField(f, rows) {
  const vals = rows.map((r) => r.answers?.[f.id]).filter((v) => !isEmpty(v));
  const base = { id: f.id, label: f.label, type: f.type, required: !!f.required, answered: vals.length, skipped: rows.length - vals.length, answerRate: pct(vals.length, rows.length) };
  if (!vals.length) return base;

  if (f.type === "select" || f.type === "checkbox") {
    const counts = new Map((f.options || []).map((o) => [o, 0]));
    let other = 0;
    for (const v of vals) for (const x of asList(v)) counts.has(x) ? counts.set(x, counts.get(x) + 1) : other++;
    const choices = [...counts].map(([label, count]) => ({ label, count, pct: pct(count, vals.length) }));
    if (other) choices.push({ label: "Other / removed option", count: other, pct: pct(other, vals.length) });
    const top = [...choices].sort((a, b) => b.count - a.count)[0];
    return { ...base, choices, top: top && top.count ? { label: top.label, count: top.count } : null };
  }
  if (f.type === "rating") {
    const nums = vals.map(Number).filter((n) => n >= 1 && n <= 5);
    const dist = [1, 2, 3, 4, 5].map((n) => ({ label: `${n}`, count: nums.filter((x) => Math.round(x) === n).length }));
    return { ...base, average: nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null, distribution: dist };
  }
  if (f.type === "number") {
    const nums = vals.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!nums.length) return base;
    return { ...base, min: round(nums[0]), max: round(nums[nums.length - 1]), mean: round(nums.reduce((a, b) => a + b, 0) / nums.length), median: round(median(nums)), histogram: histogram(nums) };
  }
  if (f.type === "date") {
    const ds = vals.map((v) => new Date(v)).filter((d) => !isNaN(d)).sort((a, b) => a - b);
    if (!ds.length) return base;
    const spanDays = (ds[ds.length - 1] - ds[0]) / 86400000;
    const key = (d) => d.toISOString().slice(0, spanDays > 62 ? 7 : 10);
    const m = new Map();
    for (const d of ds) m.set(key(d), (m.get(key(d)) || 0) + 1);
    return { ...base, earliest: ds[0].toISOString().slice(0, 10), latest: ds[ds.length - 1].toISOString().slice(0, 10), series: [...m].map(([label, count]) => ({ label, count })) };
  }
  if (f.type === "email") {
    const m = new Map();
    for (const v of vals) { const d = String(v).split("@")[1]?.toLowerCase(); if (d) m.set(d, (m.get(d) || 0) + 1); }
    return { ...base, topDomains: [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count })) };
  }
  if (f.type === "text" || f.type === "textarea") {
    const words = new Map();
    let len = 0;
    for (const v of vals) {
      const s = String(v);
      len += s.length;
      for (const w of s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) if (!STOP.has(w)) words.set(w, (words.get(w) || 0) + 1);
    }
    return { ...base, avgLength: Math.round(len / vals.length), topWords: [...words].filter(([, c]) => c > 1 || vals.length < 20).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, count]) => ({ label, count })) };
  }
  return base; // file: only the answered count
}

export function buildSummary(form, rows) {
  const fields = [...(form.fields || [])].sort((a, b) => a.order - b.order);
  const byDay = new Map();
  for (const r of rows) {
    const k = new Date(r.createdAt).toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const timeline = [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count }));
  const times = rows.map((r) => +new Date(r.createdAt));
  const summaries = fields.map((f) => summarizeField(f, rows));
  const required = summaries.filter((s) => s.required);
  return {
    total: rows.length,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    avgAnswerRate: summaries.length ? round(summaries.reduce((a, s) => a + s.answerRate, 0) / summaries.length, 1) : 0,
    timeline,
    fields: summaries,
  };
}

const AI_RAW_TYPES = new Set(["text", "textarea", "select", "checkbox", "rating", "number", "date"]);

/**
 * What the AI is allowed to see. Default: aggregates only. With includeRaw, also a
 * capped sample of recent answers, never email or file fields.
 */
export function buildAiContext(form, summary, rows, includeRaw) {
  const ctx = {
    form: { title: form.title, description: form.description || "", fieldCount: (form.fields || []).length },
    responses: { total: summary.total, firstAt: summary.firstAt, lastAt: summary.lastAt, avgAnswerRate: summary.avgAnswerRate, perDayRecent: summary.timeline.slice(-45) },
    fields: summary.fields.map(({ topDomains, ...rest }) => (rest.type === "email" ? { ...rest, note: "email addresses withheld" } : rest)),
  };
  if (includeRaw) {
    const fields = [...(form.fields || [])].sort((a, b) => a.order - b.order).filter((f) => AI_RAW_TYPES.has(f.type));
    const sample = [];
    let chars = 0;
    for (const r of [...rows].reverse().slice(0, 150)) {
      const answers = {};
      for (const f of fields) {
        let v = r.answers?.[f.id];
        if (isEmpty(v)) continue;
        v = Array.isArray(v) ? v.join(", ") : String(v);
        answers[f.label] = v.length > 300 ? `${v.slice(0, 300)}...` : v;
      }
      const size = JSON.stringify(answers).length;
      if (chars + size > 40000) break;
      chars += size;
      sample.push({ at: new Date(r.createdAt).toISOString().slice(0, 10), answers });
    }
    ctx.sampleOfRecentResponses = { note: `Most recent ${sample.length} of ${summary.total} responses. Email and file fields are excluded.`, responses: sample };
  }
  return ctx;
}
