/**
 * Nimiq Pay rejects with plain objects rather than Error instances, so the
 * usual `String(e)` fallback renders "[object Object]" and hides what the host
 * actually said. This digs the message out of every shape seen from the bridge
 * and never falls back to stringifying an object.
 */
export function formatProviderError(e: unknown, fallback = "the wallet returned an error"): string {
  const seen = new Set<unknown>();

  const dig = (value: unknown, depth: number): string | null => {
    if (depth > 4 || value === null || value === undefined) return null;
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Error) return value.message || null;
    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    const record = value as Record<string, unknown>;
    // `error` first: an ErrorResponse wraps the real message one level down.
    for (const key of ["error", "message", "reason", "description", "detail", "type"]) {
      const found = dig(record[key], depth + 1);
      if (found) return found;
    }
    return null;
  };

  const message = dig(e, 0);
  if (message) return message;

  // Last resort: show the payload itself rather than "[object Object]", so an
  // unrecognised shape is still reportable.
  try {
    const json = JSON.stringify(e);
    if (json && json !== "{}" && json !== "null") {
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
  } catch {
    /* circular or non-serialisable */
  }
  return fallback;
}
