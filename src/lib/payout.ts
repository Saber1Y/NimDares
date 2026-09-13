"server-only";

import type { DareRecord, ParticipantRecord } from "@/lib/db";
import { buildNimSweepTx, getNimEscrowInfo } from "@/lib/escrow/nim";
import { getEvmEscrowInfo, sendUsdtPayout } from "@/lib/escrow/evm";
import { NIM_DECIMALS } from "@/lib/config";

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
  reason?: string;
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
  const winners = participants.filter((p) => p.aiVerdict === "VALID");
  const losers = participants.filter((p) => p.aiVerdict !== "VALID");

  const empty: RoomSettlement = { payouts: [], bonusRaw: 0n, remainderRaw: 0n };

  if (room.asset === "USDT") {
    return { ...empty, reason: "USDT rooms not yet supported" };
  }
  const escrow = getNimEscrowInfo();
  if (!escrow.configured) {
    const reason = "ESCROW_NIM_KEY_HEX not configured";
    if (winners.length === 0) {
      const treasury = process.env.COMMUNITY_TREASURY;
      return {
        ...empty,
        reason: treasury ? reason : "COMMUNITY_TREASURY not configured",
      };
    }
    const bonusRaw = (stake * BigInt(losers.length)) / BigInt(Math.max(winners.length, 1));
    const remainderRaw = stake * BigInt(losers.length) - bonusRaw * BigInt(winners.length);
    return {
      payouts: winners.map((w) => ({
        participantId: w.id,
        address: w.userAddress,
        amountRaw: stake + bonusRaw,
        status: "PENDING",
        reason,
      })),
      bonusRaw,
      remainderRaw,
      reason,
    };
  }

  if (winners.length === 0) {
    const treasury = process.env.COMMUNITY_TREASURY;
    if (!treasury) {
      return { ...empty, reason: "COMMUNITY_TREASURY not configured" };
    }
    const pot = stake * BigInt(participants.length);
    const res = await buildNimSweepTx(treasury, pot, NIM_FEE_LUNA);
    if (!res.ok) return { ...empty, reason: res.reason };
    return {
      payouts: [
        {
          participantId: "treasury",
          address: treasury,
          amountRaw: pot,
          status: "SETTLED",
          txHash: res.txHash,
        },
      ],
      bonusRaw: 0n,
      remainderRaw: 0n,
    };
  }

  const slashedRaw = stake * BigInt(losers.length);
  const bonusRaw = slashedRaw / BigInt(winners.length);
  const remainderRaw = slashedRaw - bonusRaw * BigInt(winners.length);
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
  return { payouts, bonusRaw, remainderRaw };
}