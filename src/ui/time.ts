// "just now", "5 minutes ago", "Yesterday", "3 days ago", then a date — for the recent files list.
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minute${s < 120 ? "" : "s"} ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hour${s < 7200 ? "" : "s"} ago`;
  const day = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const days = Math.round((day(now) - day(at)) / 86400000);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
