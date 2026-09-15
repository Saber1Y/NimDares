import type { DareStatus } from "@/lib/types";

/**
 * Plain-language names for the states people see. The stored values are
 * database enums and mean nothing to someone who did not write the schema.
 */
const DARE_STATUS_LABELS: Record<DareStatus, string> = {
  PENDING_FUNDING: "Awaiting payment",
  LOBBY: "Open to join",
  ACTIVE: "In progress",
  SUBMITTED: "Proof in review",
  ADJUDICATED: "Reviewed",
  SETTLED: "Settled",
  WON: "Won",
  LOST: "Lost",
  SWEEPING: "Paying out",
  VOIDED: "Closed",
};

export function dareStatusLabel(status: DareStatus | string): string {
  return DARE_STATUS_LABELS[status as DareStatus] ?? "Unknown";
}

const VERDICT_LABELS: Record<string, string> = {
  VALID: "Verified",
  INVALID: "Not verified",
  AMBIGUOUS: "Couldn't tell",
  WAITING: "Awaiting proof",
  UNAVAILABLE: "Not checked yet",
};

export function verdictLabel(verdict: string): string {
  return VERDICT_LABELS[verdict] ?? "Awaiting proof";
}

const PAYOUT_LABELS: Record<string, string> = {
  PENDING: "On its way",
  SETTLED: "Paid out",
  FAILED: "Payment issue",
};

export function payoutLabel(status: string): string {
  return PAYOUT_LABELS[status] ?? status;
}
