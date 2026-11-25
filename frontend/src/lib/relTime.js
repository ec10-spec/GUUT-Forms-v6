// "2 hours ago", "yesterday", "3 days ago", then a short date. Full date and time go in a tooltip (fullDate).
const rtf = typeof Intl !== "undefined" && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

export function relTime(d) {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return "";
  const sec = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(sec);
  if (!rtf) return new Date(t).toLocaleDateString();
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(sec / 86400), "day");
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export const fullDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
export const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : "0");
