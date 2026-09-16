"server-only";

/**
 * Model-chain handling for Gemini adjudication.
 *
 * The free tier caps different models differently, and models get retired:
 * `gemini-2.5-flash` 404s for new users, `gemini-3.6-flash` allows only ~20
 * requests/day while `gemini-3.1-flash-lite` allows ~1500. Judging a dare must
 * not fail because one model's quota was spent during testing, so each call
 * walks an ordered chain and only reports UNAVAILABLE when every model failed.
 */

export function modelChain(): string[] {
  const explicit = process.env.GEMINI_MODELS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit && explicit.length > 0) return explicit;

  const primary = process.env.GEMINI_MODEL;
  const chain = primary
    ? [primary, "gemini-3.1-flash-lite"]
    : ["gemini-3.1-flash-lite", "gemini-3.6-flash"];

  // Keep order, drop duplicates.
  return [...new Set(chain)];
}

/**
 * Whether a failed model call justifies trying the next model in the chain.
 * Quota exhaustion (429), a retired model (404), and connection failures have
 * nothing to do with the prompt, so they are worth a retry. Any other 4xx
 * (e.g. an invalid schema) will fail identically on the next model, and
 * burning that model's quota on a doomed retry is worse than reporting now.
 */
export function isModelFallbackError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const maybe = e as { status?: number; message?: string };
  const message = maybe.message ?? "";
  if (maybe.status === 429 || maybe.status === 404) return true;
  if (typeof maybe.status !== "number" && message.length > 0) return true; // connection error
  return /RESOURCE_EXHAUSTED|quota|rate.?limit|not found|retired/i.test(message);
}

export interface ModelCall<T> {
  result: T;
  model: string;
}

/**
 * Runs `call` against each model until one succeeds, or rethrows the last
 * error. The reason is reported verbatim when a model 404s or quota is out,
 * so the caller can surface the true cause instead of a generic failure.
 */
export async function callWithModelFallback<T>(
  call: (model: string) => Promise<T>,
  models?: string[],
): Promise<ModelCall<T>> {
  const chain = models ?? modelChain();
  let lastError: unknown;
  for (const model of chain) {
    try {
      return { result: await call(model), model };
    } catch (e) {
      lastError = e;
      if (!isModelFallbackError(e)) throw e;
    }
  }
  throw lastError;
}

/** Short, human-facing summary of why every model in the chain was unusable. */
export function modelChainFailureReason(e: unknown, models: string[]): string {
  const message = e instanceof Error ? e.message : String(e);
  // Explain what the user can actually do, not which API limit tripped.
  if (/quota|RESOURCE_EXHAUSTED|rate.?limit|exceed/i.test(message)) {
    return "the AI judge is at capacity right now (its daily request limit is drained). Your proof is stored safely and will be ruled on automatically; you can also resubmit a clearer screenshot later.";
  }
  if (/not found|retired/i.test(message)) {
    return `the AI judge model is unavailable right now (${models.join(", ")}). Your proof is stored safely and will be ruled on when the judge is back.`;
  }
  return `the judge could not rule right now (${models.join(", ")}). Your proof is stored safely and will be ruled on automatically.`;
}

export function lastErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}