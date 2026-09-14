export type Asset = "NIM" | "USDT";

export type DareStatus =
  | "PENDING_FUNDING"
  | "LOBBY"
  | "ACTIVE"
  | "SUBMITTED"
  | "ADJUDICATED"
  | "SETTLED"
  | "WON"
  | "LOST"
  | "SWEEPING"
  | "VOIDED";

export type VerifierKind = "VISION" | "GITHUB" | "STRAVA";

export type PayoutStatus = "PENDING" | "SETTLED" | "FAILED" | null;

export interface DareVerifierResult {
  status: "VALID" | "INVALID" | "AMBIGUOUS" | "UNAVAILABLE" | "WAITING";
  reason?: string;
  source?: string;
  /** Probability the goal was met, 0-100. */
  confidence?: number;
  /** What the judge reported seeing in the screenshot. */
  observations?: string;
  ruledAt?: string;
}

/** Proof requirements fixed when the dare was created and shown before staking. */
export interface EvidenceSpecView {
  requirements: string[];
  expectedArtifact: string;
}

export interface Dare {
  id: string;
  ownerAddress: string;
  title: string;
  description: string;
  criteria: string;
  asset: Asset;
  amount: number; // NIM units or USDT units (human-readable)
  maxCapacity: number;
  isPrivate: boolean;
  roomCode: string | null;
  deadline: string;
  status: DareStatus;
  verifierKind: VerifierKind;
  verifierLink?: string | null;
  verifierResult: DareVerifierResult | null;
  evidenceSpec: EvidenceSpecView | null;
  proofAttempts: number;
  proofImageUrl?: string | null;
  createdAt: string;
  escrowTxHash?: string | null;
  payoutTxHash?: string | null;
  payoutStatus: PayoutStatus;
  funded: boolean;
  escrow: { address: string | null; configured: boolean } | null;
}

export interface LedgerSummary {
  active: number;
  escrowedNim: number;
  escrowedUsdt: number;
  won: number;
  lost: number;
}

export type RoomMode = "solo" | "team" | "arena";

export interface Participant {
  id: string;
  userAddress: string;
  funded: boolean;
  fundingTxHash: string | null;
  proofImageUrl?: string | null;
  proofLink?: string | null;
  aiVerdict: "VALID" | "INVALID" | "AMBIGUOUS" | "WAITING" | "UNAVAILABLE";
  verdictReason: string | null;
  confidence: number | null;
  proofAttempts: number;
  joinedAt: string;
}