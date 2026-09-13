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
  status: "VALID" | "INVALID" | "UNAVAILABLE" | "WAITING";
  reason?: string;
  source?: string;
  ruledAt?: string;
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