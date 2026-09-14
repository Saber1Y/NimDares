"server-only";

import { createHash } from "node:crypto";
import type { AdjudicationResult } from "@/lib/adjudicate";
import type { DareRecord } from "@/lib/db";
import { getStore } from "@/lib/db";
import { MAX_PROOF_ATTEMPTS } from "@/lib/config";

/**
 * Judging runs on submission, not at the deadline, so a user learns straight
 * away whether their evidence passed and can replace a rejected or inconclusive
 * screenshot while the dare is still open. Attempts are capped: each one costs
 * a model call, and an unlimited retry loop is an invitation to fish for a pass.
 */
export { MAX_PROOF_ATTEMPTS } from "@/lib/config";

/** SHA-256 of the decoded image bytes. Hashed here, never trusted from the client. */
export function hashProofImage(dataUrl: string): string | null {
  const b64 = dataUrl.split(",")[1];
  if (!b64) return null;
  try {
    return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
  } catch {
    return null;
  }
}

export interface ProofGate {
  ok: boolean;
  error?: string;
  httpStatus?: number;
  hash?: string;
}

/**
 * Rejects replays and exhausted attempts before any model call, which keeps a
 * recycled screenshot from ever reaching the judge.
 */
export async function gateProofImage(
  dataUrl: string,
  attemptsUsed: number,
  scope: { dareId?: string; participantId?: string },
): Promise<ProofGate> {
  if (attemptsUsed >= MAX_PROOF_ATTEMPTS) {
    return {
      ok: false,
      httpStatus: 409,
      error: `no proof attempts left (limit ${MAX_PROOF_ATTEMPTS})`,
    };
  }
  const hash = hashProofImage(dataUrl);
  if (!hash) {
    return { ok: false, httpStatus: 400, error: "proof image could not be decoded" };
  }
  const store = getStore();
  // Catches the same file reused across dares. A re-crop or re-encode defeats
  // it; it is a cheap floor, not forgery detection.
  if (await store.proofHashSeen(hash, scope)) {
    return {
      ok: false,
      httpStatus: 409,
      error: "this screenshot has already been submitted as proof",
    };
  }
  return { ok: true, hash };
}

/** Whether a user may still replace their proof for this dare. */
export function canResubmit(dare: DareRecord, attemptsUsed: number, verdictStatus?: string): boolean {
  if (new Date(dare.deadline).getTime() <= Date.now()) return false;
  if (verdictStatus === "VALID") return false;
  return attemptsUsed < MAX_PROOF_ATTEMPTS;
}

export function verdictToRecord(verdict: AdjudicationResult) {
  return {
    status: verdict.status,
    reason: verdict.reason,
    source: verdict.source,
    confidence: verdict.confidence,
    observations: verdict.observations,
    ruledAt: new Date().toISOString(),
  };
}
