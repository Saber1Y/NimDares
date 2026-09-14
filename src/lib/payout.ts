"server-only";

import type { DareRecord, ParticipantRecord } from "@/lib/db";
import { buildNimSweepTx, getNimEscrowInfo, getNimCommunityTreasuryAddress } from "@/lib/escrow/nim";
import { getEvmEscrowInfo, sendUsdtPayout } from "@/lib/escrow/evm";
import { NIM_DECIMALS, POOL_FEE_BPS } from "@/lib/config";

export interface PayoutResult {
  status: "SETTLED" | "PENDING" | "FAILED";
  txHash?: string;
  reason?: string;
}

export interface SeatPayout {
  participantId: string;
  address: string;
  amountRaw: bigint;
  status: "SETTLED" | "PENDING" | "FAILED";
  txHash?: string;
  reason?: string;
}

export interface RoomSettlement {
  payouts: SeatPayout[];
  bonusRaw: bigint;
  remainderRaw: bigint;
  /** Platform cut taken from the redistributed pot. */
  feeRaw: bigint;
  reason?: string;
}

/** Pseudo participant ids for payouts that do not belong to a seat. */
export const TREASURY_PAYOUT_ID = "treasury";
export const PLATFORM_FEE_PAYOUT_ID = "platform-fee";

/**
 * Splits the forfeited stakes: platform cut first, the rest shared equally
 * between the seats that verified. Integer division leaves a remainder that
 * stays in escrow rather than being handed to an arbitrary winner.
 */
export function splitPot(slashedRaw: bigint, winnerCount: number) {
  const feeRaw = (slashedRaw * BigInt(POOL_FEE_BPS)) / 10_000n;
  const distributableRaw = slashedRaw - feeRaw;
  const bonusRaw = winnerCount > 0 ? distributableRaw / BigInt(winnerCount) : 0n;
  const remainderRaw = distributableRaw - bonusRaw * BigInt(winnerCount);
  return { feeRaw, bonusRaw, remainderRaw };
}

const NIM_FEE_LUNA = BigInt(process.env.NIM_FEE_LUNA ?? "100");

export async function payoutDare(dare: DareRecord): Promise<PayoutResult> {
  const escrowNim = getNimEscrowInfo();
  const escrowEvm = getEvmEscrowInfo();
  const escrowConfigured = dare.asset === "NIM" ? escrowNim.configured : escrowEvm.configured;
  if (!escrowConfigured) {
    return {
      status: "PENDING",
      reason:
        dare.asset === "NIM"
          ? "ESCROW_NIM_KEY_HEX not configured"
          : "ESCROW_EVM_KEY_HEX not configured",
    };
  }

  if (dare.asset === "NIM") {
    const res = await buildNimSweepTx(dare.ownerAddress, dare.amountRaw, NIM_FEE_LUNA);
    if (!res.ok) return { status: "FAILED", reason: res.reason };
    return { status: "SETTLED", txHash: res.txHash };
  }

  const res = await sendUsdtPayout(dare.ownerAddress, dare.amountRaw);
  if (!res.ok) return { status: "FAILED", reason: res.reason };
  return { status: "SETTLED", txHash: res.txHash };
}

export function toHumanAmount(asset: "NIM" | "USDT", amountRaw: bigint): number {
  return asset === "NIM"
    ? Number(amountRaw) / NIM_DECIMALS
    : Number(amountRaw) / 1_000_000;
}

export async function settleRoom(
  room: DareRecord,
  participants: ParticipantRecord[]
): Promise<RoomSettlement> {
  const stake = room.amountRaw;
  // Only seats that actually paid take part. An unfunded seat contributed
  // nothing to the pot, so counting it would inflate the winners' bonus beyond
  // what escrow holds - and a VALID ruling on one would pay out a stake that
  // was never deposited.
  const seated = participants.filter((p) => p.fundedAt !== null);
  const winners = seated.filter((p) => p.aiVerdict === "VALID");
  // An inconclusive ruling returns the seat's own stake: it neither wins a
  // share of the pot nor feeds one. Only a clear INVALID is slashed.
  const refunded = seated.filter(
    (p) => p.aiVerdict === "AMBIGUOUS" || p.aiVerdict === "UNAVAILABLE",
  );
  const losers = seated.filter(
    (p) => p.aiVerdict !== "VALID" && p.aiVerdict !== "AMBIGUOUS" && p.aiVerdict !== "UNAVAILABLE",
  );

  const empty: RoomSettlement = { payouts: [], bonusRaw: 0n, remainderRaw: 0n, feeRaw: 0n };

  if (room.asset === "USDT") {
    return { ...empty, reason: "USDT rooms not yet supported" };
  }
  const escrow = getNimEscrowInfo();
  if (!escrow.configured) {
    const reason = "ESCROW_NIM_KEY_HEX not configured";
    if (winners.length === 0) {
      const treasury = getNimCommunityTreasuryAddress();
      return {
        ...empty,
        reason: treasury ? reason : "COMMUNITY_TREASURY not configured",
      };
    }
    const { feeRaw, bonusRaw, remainderRaw } = splitPot(
      stake * BigInt(losers.length),
      winners.length,
    );
    return {
      feeRaw,
      payouts: [
        ...winners.map((w) => ({
          participantId: w.id,
          address: w.userAddress,
          amountRaw: stake + bonusRaw,
          status: "PENDING" as const,
          reason,
        })),
        ...refunded.map((r) => ({
          participantId: r.id,
          address: r.userAddress,
          amountRaw: stake,
          status: "PENDING" as const,
          reason,
        })),
      ],
      bonusRaw,
      remainderRaw,
      reason,
    };
  }

  if (winners.length === 0) {
    // Nobody verified: there is no one to share the pot with, so all of it -
    // fee included - goes to the treasury. Inconclusive seats still get theirs.
    const payouts = await refundSeats(refunded, stake);
    const pot = stake * BigInt(losers.length);
    if (pot === 0n) {
      return { payouts, bonusRaw: 0n, remainderRaw: 0n, feeRaw: 0n };
    }
    const treasury = getNimCommunityTreasuryAddress();
    if (!treasury) {
      return {
        payouts,
        bonusRaw: 0n,
        remainderRaw: 0n,
        feeRaw: 0n,
        reason: "COMMUNITY_TREASURY not configured",
      };
    }
    const res = await buildNimSweepTx(treasury, pot, NIM_FEE_LUNA);
    if (!res.ok) return { payouts, bonusRaw: 0n, remainderRaw: 0n, feeRaw: 0n, reason: res.reason };
    return {
      payouts: [
        ...payouts,
        {
          participantId: TREASURY_PAYOUT_ID,
          address: treasury,
          amountRaw: pot,
          status: "SETTLED",
          txHash: res.txHash,
        },
      ],
      bonusRaw: 0n,
      remainderRaw: 0n,
      feeRaw: 0n,
    };
  }

  const slashedRaw = stake * BigInt(losers.length);
  const { feeRaw, bonusRaw, remainderRaw } = splitPot(slashedRaw, winners.length);
  const payouts: SeatPayout[] = [];
  for (const w of winners) {
    const amount = stake + bonusRaw;
    const res = await buildNimSweepTx(w.userAddress, amount, NIM_FEE_LUNA);
    payouts.push(
      res.ok
        ? { participantId: w.id, address: w.userAddress, amountRaw: amount, status: "SETTLED", txHash: res.txHash }
        : { participantId: w.id, address: w.userAddress, amountRaw: amount, status: "FAILED", reason: res.reason }
    );
  }
  payouts.push(...(await refundSeats(refunded, stake)));

  if (feeRaw > 0n) {
    const treasury = getNimCommunityTreasuryAddress();
    if (treasury) {
      const res = await buildNimSweepTx(treasury, feeRaw, NIM_FEE_LUNA);
      payouts.push({
        participantId: PLATFORM_FEE_PAYOUT_ID,
        address: treasury,
        amountRaw: feeRaw,
        status: res.ok ? "SETTLED" : "FAILED",
        txHash: res.ok ? res.txHash : undefined,
        reason: res.ok ? undefined : res.reason,
      });
    }
    // With no treasury configured the cut simply stays in escrow rather than
    // being invented as a payout.
  }

  return { payouts, bonusRaw, remainderRaw, feeRaw };
}

/** Returns each inconclusive seat its own stake, nothing more. */
async function refundSeats(seats: ParticipantRecord[], stake: bigint): Promise<SeatPayout[]> {
  const payouts: SeatPayout[] = [];
  for (const seat of seats) {
    const res = await buildNimSweepTx(seat.userAddress, stake, NIM_FEE_LUNA);
    payouts.push(
      res.ok
        ? { participantId: seat.id, address: seat.userAddress, amountRaw: stake, status: "SETTLED", txHash: res.txHash }
        : { participantId: seat.id, address: seat.userAddress, amountRaw: stake, status: "FAILED", reason: res.reason }
    );
  }
  return payouts;
}