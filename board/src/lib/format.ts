/** Duration between two ISO timestamps, "45s" / "3m 20s". Empty on bad input. */
export function fmtDur(start?: string, end?: string): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Compact duration for dense lists, "45s" / "18m" / "1h 3m". Empty on bad input. */
export function fmtDurCompact(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
