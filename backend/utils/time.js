// Time zone helpers. Charts, exports and usage pages group by the VIEWER's day, not by UTC, so a response
// sent at 8 PM in California lands on that day. The client sends its IANA zone (e.g. America/Los_Angeles).

const cache = new Map();

/** A valid IANA zone name, or "UTC". */
export function safeTz(tz) {
  const s = String(tz || "").trim();
  if (!s || s.length > 64) return "UTC";
  if (cache.has(s)) return s;
  try {
    cache.set(s, new Intl.DateTimeFormat("en-CA", { timeZone: s, year: "numeric", month: "2-digit", day: "2-digit" }));
    return s;
  } catch {
    return "UTC";
  }
}

function fmt(tz) {
  const z = safeTz(tz);
  if (!cache.has(z)) cache.set(z, new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }));
  return cache.get(z);
}

/** YYYY-MM-DD of a moment in the given zone. */
export function dayKey(date, tz = "UTC") {
  const parts = fmt(tz).formatToParts(new Date(date));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "2026-10-27 20:10" in the given zone (24h clock). */
export function localDateTime(date, tz = "UTC") {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: safeTz(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return s.replace(",", "");
}

const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (key) => {
  const d = new Date(`${key}T00:00:00Z`);
  return addDays(key, -((d.getUTCDay() + 6) % 7));
};

/**
 * Zero-filled series from a map of day -> count. The bucket size follows the span:
 * up to 62 days by day, up to about 1 year by week (weeks start Monday), longer by month.
 */
export function bucketSeries(byDay) {
  const keys = [...byDay.keys()].sort();
  if (!keys.length) return { unit: "day", points: [] };
  const first = keys[0], last = keys[keys.length - 1];
  const span = (new Date(`${last}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / 86400000;
  const unit = span <= 62 ? "day" : span <= 400 ? "week" : "month";
  const keyOf = (k) => (unit === "day" ? k : unit === "week" ? mondayOf(k) : k.slice(0, 7));
  const counts = new Map();
  for (const [k, c] of byDay) counts.set(keyOf(k), (counts.get(keyOf(k)) || 0) + c);
  const points = [];
  if (unit === "month") {
    let [y, m] = first.slice(0, 7).split("-").map(Number);
    const [ly, lm] = last.slice(0, 7).split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      points.push({ date: k, count: counts.get(k) || 0 });
      if (++m > 12) { m = 1; y++; }
    }
  } else {
    const step = unit === "day" ? 1 : 7;
    for (let k = keyOf(first); k <= last; k = addDays(k, step)) points.push({ date: k, count: counts.get(k) || 0 });
  }
  return { unit, points };
}
