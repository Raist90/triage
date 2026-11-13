const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Compact relative time: "3m", "2h", "4d", "2w", then a date. */
export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);

  if (absolute < MINUTE) return "now";
  if (absolute < HOUR) return `${Math.round(absolute / MINUTE)}m`;
  if (absolute < DAY) return `${Math.round(absolute / HOUR)}h`;
  if (absolute < WEEK) return `${Math.round(absolute / DAY)}d`;
  if (absolute < 5 * WEEK) return `${Math.round(absolute / WEEK)}w`;

  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}
