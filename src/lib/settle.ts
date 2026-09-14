"server-only";

import { getStore } from "@/lib/db";
import type { DareRecord } from "@/lib/db";
import { payoutDare, type PayoutResult } from "@/lib/payout";

/**
 * Returns a solo stake the moment the proof is ruled valid, rather than making
 * the user wait for the deadline. Pooled dares settle only when the dare ends,
 * because a seat's share depends on how everyone else is ruled.
 *
 * Safe to call more than once: the payout is claimed in the store before the
 * transfer is built, and an already-settled dare short-circuits.
 */
export async function settleSoloWin(dareId: string): Promise<PayoutResult> {
  const store = getStore();
  const dare = await store.getDare(dareId);
  if (!dare) return { status: "FAILED", reason: "dare not found" };
  if (dare.maxCapacity > 1) {
    return { status: "FAILED", reason: "pooled dares settle at the deadline" };
  }
  if (!dare.fundedAt) {
    return { status: "FAILED", reason: "dare was never funded" };
  }
  if (dare.payoutStatus === "SETTLED" || dare.payoutTxHash) {
    return { status: "SETTLED", txHash: dare.payoutTxHash ?? undefined };
  }
  if (dare.payoutStatus === "PENDING" && dare.status === "WON") {
    // Another call is mid-flight, or a previous one could not broadcast. The
    // sweep retries these; never build a second transfer here.
    return { status: "PENDING", reason: "payout already in progress" };
  }

  // Claim the payout before any money moves, so a duplicate request sees it.
  await store.updateDare(dareId, { status: "WON", payoutStatus: "PENDING" });

  const payout = await payoutDare(dare);
  await store.updateDare(dareId, {
    payoutStatus: payout.status,
    payoutTxHash: payout.txHash ?? null,
  });
  await store.recordTx({
    dareId,
    kind: "PAYOUT",
    chain: dare.asset === "NIM" ? "NIM" : "EVM",
    asset: dare.asset,
    amountRaw: dare.amountRaw,
    toAddress: dare.ownerAddress,
    txHash: payout.txHash ?? null,
    status: payout.status === "SETTLED" ? "CONFIRMED" : "PENDING",
  });
  return payout;
}

/**
 * Retries a solo transfer that was claimed but never broadcast (escrow offline,
 * RPC failure) - a won stake or an inconclusive refund. Without this the money
 * would be stranded: WON and VOIDED dares are past every other branch of the
 * sweep. A dare that was never funded has no payoutStatus and is skipped.
 */
export async function retrySoloPayout(dare: DareRecord): Promise<PayoutResult | null> {
  if (dare.maxCapacity > 1) return null;
  if (!dare.fundedAt) return null;
  if (dare.status !== "WON" && dare.status !== "VOIDED") return null;
  if (!dare.payoutStatus || dare.payoutStatus === "SETTLED") return null;
  if (dare.payoutTxHash) return null;

  const store = getStore();
  const payout = await payoutDare(dare);
  await store.updateDare(dare.id, {
    payoutStatus: payout.status,
    payoutTxHash: payout.txHash ?? null,
  });
  if (payout.status === "SETTLED") {
    await store.recordTx({
      dareId: dare.id,
      kind: "PAYOUT",
      chain: dare.asset === "NIM" ? "NIM" : "EVM",
      asset: dare.asset,
      amountRaw: dare.amountRaw,
      toAddress: dare.ownerAddress,
      txHash: payout.txHash ?? null,
      status: "CONFIRMED",
    });
  }
  return payout;
}
