/**
 * Dares are judged against times a person can see in a screenshot, and those
 * are in the creator's local zone with no marker on them. Storing the zone the
 * dare was created in lets the judge read "Sep 16" the same way its owner does,
 * instead of against a UTC instant that can be a calendar day off.
 */

/** True when the string is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The viewer's own zone, e.g. "Europe/Berlin". Undefined where unavailable. */
export function currentTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}

/** Falls back to UTC, which is what an unlabelled dare was always judged in. */
export function zoneOrUtc(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : "UTC";
}

/**
 * Wall-clock time as the dare's owner would read it, with the zone named so
 * the judge has one unambiguous frame of reference.
 */
export function formatInZone(date: Date | string, tz: string | null | undefined): string {
  const zone = zoneOrUtc(tz);
  const value = typeof date === "string" ? new Date(date) : date;
  const stamp = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone,
  }).format(value);
  return `${stamp} (${zone})`;
}

/** Calendar day in the dare's zone, e.g. "2026-09-16". */
export function dayInZone(date: Date | string, tz: string | null | undefined): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", { timeZone: zoneOrUtc(tz) }).format(value);
}
