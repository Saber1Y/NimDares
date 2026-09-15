"server-only";

import { getStore } from "@/lib/db";
import type { DareRecord, ParticipantRecord } from "@/lib/db";
import {
  fetchNimIncomingTxs,
  fetchNimTxByHash,
  getNimEscrowInfo,
  nimTxHashFromRef,
  type NimIncomingTx,
  type NimTx,
} from "@/lib/escrow/nim";

export type FundingStatus = "funded" | "pending" | "rejected";

export interface FundingResult {
  status: FundingStatus;
  txHash?: string;
  error?: string;
}

interface ConfirmOptions {
  /** Hash or serialized transaction handed back by the wallet. */
  txRef?: string | null;
  /** Room seat to credit; resolved from payerAddress when omitted. */
  participantId?: string | null;
  payerAddress?: string | null;
  /** Lookup attempts. A just-broadcast transaction needs a block (~1s). */
  attempts?: number;
  /** Scan escrow for a matching deposit when no reference is known (manual transfers). */
  scan?: boolean;
}

const strip = (a: string) => a.replace(/\s+/g, "");
const RETRY_DELAY_MS = 700;

/** Pulls the dare/seat reference out of a `nimdares:<ref>` memo. */
function memoRef(memo: string): string | null {
  const parts = memo.split(":");
  if (parts.length < 2 || parts[0] !== "nimdares") return null;
  return parts[parts.length - 1] || null;
}

async function lookupTx(hash: string, attempts: number): Promise<NimTx | null> {
  for (let i = 0; i < attempts; i += 1) {
    const tx = await fetchNimTxByHash(hash);
    if (tx) return tx;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return null;
}

/** Checks a deposit against the stake it claims to settle, then credits it. */
async function settle(
  dare: DareRecord,
  seat: ParticipantRecord | null,
  tx: NimTx | NimIncomingTx,
  escrowAddress: string,
): Promise<FundingResult> {
  const store = getStore();
  const expected = seat ? seat.stakeRaw : dare.amountRaw;
  const payer = seat ? seat.userAddress : dare.ownerAddress;
  const hash = tx.hash;

  if ("executionOk" in tx && !tx.executionOk) {
    return { status: "rejected", error: "the transaction failed on-chain", txHash: hash };
  }
  if ("toAddress" in tx && strip(tx.toAddress) !== strip(escrowAddress)) {
    return { status: "rejected", error: "payment was not sent to escrow", txHash: hash };
  }
  if (tx.value !== expected) {
    return {
      status: "rejected",
      error: `escrow received ${tx.value} luna, expected ${expected}`,
      txHash: hash,
    };
  }
  // Nimiq Pay signs with one account and can pay from another, so the sender is
  // not required to equal the address that created the dare. The deposit still
  // has to name this stake in its memo; only a memo-less deposit has to come
  // from the owner, because the sender is then the sole thing tying it here.
  const memoMatches = tx.memo ? memoRef(tx.memo) === (seat ? seat.id : dare.id) : false;
  if (!memoMatches && strip(tx.fromAddress) !== strip(payer)) {
    return {
      status: "rejected",
      error: "this transaction does not reference this stake",
      txHash: hash,
    };
  }

  // One deposit settles one stake, across every dare and room seat.
  const claimedBy = await store.findFundedByTxHash(hash);
  const isOwnClaim = seat
    ? claimedBy?.kind === "participant" && claimedBy.id === seat.id
    : claimedBy?.kind === "dare" && claimedBy.id === dare.id;
  if (claimedBy && !isOwnClaim) {
    return { status: "rejected", error: "this deposit already funded another stake", txHash: hash };
  }

  const now = new Date();
  if (seat) {
    await store.updateParticipant(seat.id, { fundingTxHash: hash, fundedAt: now });
    if (dare.status === "LOBBY") {
      await store.updateDare(dare.id, { status: "ACTIVE", fundedAt: now });
    }
  } else {
    await store.updateDare(dare.id, { status: "ACTIVE", fundedAt: now, escrowTxHash: hash });
  }
  try {
    // getEscrowBalance upserts the ledger row; bump alone throws when it is
    // missing. Bookkeeping must never undo a settlement that already happened.
    await store.getEscrowBalance("NIM", "NIM", escrowAddress);
    await store.bumpEscrowBalance("NIM", "NIM", escrowAddress, tx.value);
  } catch (e) {
    console.error("escrow ledger bump failed", { dareId: dare.id, hash }, e);
  }

  return { status: "funded", txHash: hash };
}

/** Finds an unclaimed escrow deposit for this stake — the manual-transfer path. */
async function scanForDeposit(
  dare: DareRecord,
  seat: ParticipantRecord | null,
  escrowAddress: string,
): Promise<NimIncomingTx | null> {
  const target = seat ? seat.id : dare.id;
  const expected = seat ? seat.stakeRaw : dare.amountRaw;
  const payer = seat ? seat.userAddress : dare.ownerAddress;
  const txs = await fetchNimIncomingTxs(escrowAddress).catch(() => []);

  for (const tx of txs) {
    if (tx.value !== expected) continue;
    if (tx.memo) {
      if (memoRef(tx.memo) === target) return tx;
      continue;
    }
    // A memo-less deposit is only credited to a solo stake from its owner.
    if (!seat && strip(tx.fromAddress) === strip(payer)) return tx;
  }
  return null;
}

/**
 * Settles a NIM stake against the chain using the reference the wallet returned.
 * There is no background worker: this runs when the payment comes back from
 * Nimiq Pay, and again on read for a deposit that was not in a block yet.
 */
export async function confirmNimFunding(
  dareId: string,
  opts: ConfirmOptions = {},
): Promise<FundingResult> {
  const store = getStore();
  const dare = await store.getDare(dareId);
  if (!dare) return { status: "rejected", error: "dare not found" };
  if (dare.asset !== "NIM") {
    return { status: "rejected", error: "this dare does not use NIM escrow" };
  }

  const escrow = getNimEscrowInfo();
  if (!escrow.configured) {
    return { status: "rejected", error: "NIM escrow is not configured" };
  }

  const isRoom = dare.maxCapacity > 1;
  let seat = opts.participantId ? await store.getParticipant(opts.participantId) : null;
  if (seat && seat.dareId !== dareId) {
    return { status: "rejected", error: "seat belongs to another dare" };
  }
  if (isRoom && !seat && opts.payerAddress) {
    const seats = await store.listParticipants(dareId);
    seat = seats.find((p) => strip(p.userAddress) === strip(opts.payerAddress!)) ?? null;
  }
  if (isRoom && !seat) {
    return { status: "rejected", error: "no seat found for this payer" };
  }

  if (seat ? seat.fundedAt : dare.fundedAt) {
    return {
      status: "funded",
      txHash: (seat ? seat.fundingTxHash : dare.escrowTxHash) ?? undefined,
    };
  }

  const ref = opts.txRef ?? (seat ? seat.fundingTxHash : dare.escrowTxHash);
  if (ref) {
    const hash = nimTxHashFromRef(ref);
    if (!hash) {
      return { status: "rejected", error: "unrecognised transaction reference" };
    }
    // Record the claim before verifying it, so a deposit that is not in a block
    // yet can be settled on a later read without the client holding the hash.
    const stored = seat ? seat.fundingTxHash : dare.escrowTxHash;
    if (stored !== hash) {
      if (seat) await store.updateParticipant(seat.id, { fundingTxHash: hash });
      else await store.updateDare(dare.id, { escrowTxHash: hash });
    }

    const tx = await lookupTx(hash, Math.max(1, opts.attempts ?? 1));
    if (!tx) return { status: "pending", txHash: hash };

    const result = await settle(dare, seat, tx, escrow.address);
    if (result.status === "rejected") {
      // The claimed transaction is not a valid deposit for this stake. Drop the
      // claim, or it would shadow every later payment: the reference path runs
      // before the scan, so a stuck bad hash would block settlement forever.
      if (seat) await store.updateParticipant(seat.id, { fundingTxHash: null });
      else await store.updateDare(dare.id, { escrowTxHash: null });
    }
    return result;
  }

  if (opts.scan ?? true) {
    const deposit = await scanForDeposit(dare, seat, escrow.address);
    if (deposit) return settle(dare, seat, deposit, escrow.address);
  }
  return { status: "pending" };
}
