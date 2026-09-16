"server-only";

import { getStore } from "@/lib/db";
import type { DareRecord, ParticipantRecord } from "@/lib/db";
import { buildNimSweepTx } from "@/lib/escrow/nim";
import { payoutDare } from "@/lib/payout";

const NIM_FEE_LUNA = BigInt(process.env.NIM_FEE_LUNA ?? "100");

export type CancelRefund = {
  participantId: string | null;
  address: string;
  amountRaw: bigint;
  status: "PENDING" | "SETTLED" | "FAILED";
  txHash?: string;
  reason?: string;
};

export type CancelResult =
  | { kind: "deleted"; dareId: string; refunds: [] }
  | { kind: "voided"; dare: DareRecord; refunds: CancelRefund[] };

export class CancelError extends Error {
  constructor(
    public readonly code: string,
  ) {
    super(code);
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.replace(/\s+/g, "").toUpperCase() === right.replace(/\s+/g, "").toUpperCase();
}

function proofSubmitted(dare: DareRecord, participants: ParticipantRecord[]): boolean {
  if (dare.proofImageUrl || dare.verifierResult?.status !== undefined && dare.verifierResult.status !== "WAITING") {
    return true;
  }
  return participants.some(
    (seat) => seat.proofImageUrl || seat.proofLink || seat.aiVerdict !== "WAITING",
  );
}

function assertCancellable(dare: DareRecord, participants: ParticipantRecord[], actorAddress: string) {
  if (!sameAddress(dare.ownerAddress, actorAddress)) throw new CancelError("only the dare creator can cancel it");
  if (!["PENDING_FUNDING", "LOBBY", "ACTIVE"].includes(dare.status)) {
    throw new CancelError(`cannot cancel a dare in ${dare.status}`);
  }
  if (dare.deadline.getTime() <= Date.now()) throw new CancelError("the deadline has passed");
  if (proofSubmitted(dare, participants)) throw new CancelError("cannot cancel after proof submission");
}

async function refundSolo(dare: DareRecord): Promise<CancelRefund> {
  const store = getStore();
  await store.updateDare(dare.id, {
    status: "VOIDED",
    payoutStatus: "PENDING",
    verifierResult: { status: "INVALID", reason: "cancelled by owner" },
  });

  const payout = await payoutDare(dare);
  await store.updateDare(dare.id, {
    payoutStatus: payout.status,
    payoutTxHash: payout.txHash ?? null,
  });
  await store.recordTx({
    dareId: dare.id,
    kind: "PAYOUT",
    chain: dare.asset === "NIM" ? "NIM" : "EVM",
    asset: dare.asset,
    amountRaw: dare.amountRaw,
    toAddress: dare.ownerAddress,
    txHash: payout.txHash ?? null,
    status: payout.status === "SETTLED" ? "CONFIRMED" : "PENDING",
  });

  return {
    participantId: null,
    address: dare.ownerAddress,
    amountRaw: dare.amountRaw,
    status: payout.status,
    txHash: payout.txHash,
    reason: payout.reason,
  };
}

async function refundSeat(dare: DareRecord, seat: ParticipantRecord): Promise<CancelRefund> {
  const store = getStore();
  const payout = await buildNimSweepTx(seat.userAddress, seat.stakeRaw, NIM_FEE_LUNA);
  const status = payout.ok ? "SETTLED" : "PENDING";
  await store.updateParticipant(seat.id, {
    payoutAmountRaw: seat.stakeRaw,
    payoutStatus: status,
    payoutTxHash: payout.txHash ?? null,
  });
  await store.recordTx({
    dareId: dare.id,
    kind: "PAYOUT",
    chain: "NIM",
    asset: "NIM",
    amountRaw: seat.stakeRaw,
    toAddress: seat.userAddress,
    txHash: payout.txHash ?? null,
    status: payout.ok ? "CONFIRMED" : "PENDING",
  });
  return {
    participantId: seat.id,
    address: seat.userAddress,
    amountRaw: seat.stakeRaw,
    status,
    txHash: payout.txHash,
    reason: payout.reason,
  };
}

export async function cancelDare(dareId: string, actorAddress: string): Promise<CancelResult> {
  const store = getStore();
  const dare = await store.getDare(dareId);
  if (!dare) throw new CancelError("dare not found");
  const participants = await store.listParticipants(dareId);
  assertCancellable(dare, participants, actorAddress);

  const fundedSeats = participants.filter((seat) => seat.fundedAt !== null);
  if (!dare.fundedAt && fundedSeats.length === 0) {
    await store.deleteDare(dare.id);
    return { kind: "deleted", dareId: dare.id, refunds: [] };
  }

  if (dare.maxCapacity > 1) {
    if (dare.asset !== "NIM") throw new CancelError("USDT room refunds are not supported yet");
    await store.updateDare(dare.id, {
      status: "VOIDED",
      verifierResult: { status: "INVALID", reason: "cancelled by owner" },
    });
    const refunds: CancelRefund[] = [];
    for (const seat of fundedSeats) refunds.push(await refundSeat(dare, seat));
    return { kind: "voided", dare: (await store.getDare(dare.id)) ?? dare, refunds };
  }

  const refund = await refundSolo(dare);
  return { kind: "voided", dare: (await store.getDare(dare.id)) ?? dare, refunds: [refund] };
}

export async function retryVoidedRoomRefunds(dare: DareRecord): Promise<number> {
  if (dare.status !== "VOIDED" || dare.maxCapacity <= 1 || dare.asset !== "NIM") return 0;
  const store = getStore();
  const participants = await store.listParticipants(dare.id);
  let settled = 0;
  for (const seat of participants) {
    if (!seat.fundedAt || !["PENDING", "FAILED"].includes(seat.payoutStatus ?? "")) continue;
    if (seat.payoutTxHash) continue;
    const payout = await buildNimSweepTx(seat.userAddress, seat.stakeRaw, NIM_FEE_LUNA);
    await store.updateParticipant(seat.id, {
      payoutStatus: payout.ok ? "SETTLED" : "PENDING",
      payoutTxHash: payout.txHash ?? null,
    });
    if (payout.ok) {
      settled += 1;
      await store.recordTx({
        dareId: dare.id,
        kind: "PAYOUT",
        chain: "NIM",
        asset: "NIM",
        amountRaw: seat.stakeRaw,
        toAddress: seat.userAddress,
        txHash: payout.txHash,
        status: "CONFIRMED",
      });
    }
  }
  return settled;
}
