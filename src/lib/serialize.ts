import type { DareRecord, EscrowBalanceRecord, LedgerSummary } from "@/lib/db";
import { NIM_DECIMALS } from "@/lib/config";
import { getNimEscrowInfo } from "@/lib/escrow/nim";
import { getEvmEscrowInfo } from "@/lib/escrow/evm";
import type { Asset, Dare } from "@/lib/types";

function escrowFor(asset: Asset) {
  const info = asset === "NIM" ? getNimEscrowInfo() : getEvmEscrowInfo();
  return { address: info.configured ? info.address : null, configured: info.configured };
}

export function dareToClient(d: DareRecord): Dare {
  return {
    id: d.id,
    ownerAddress: d.ownerAddress,
    title: d.title,
    description: d.description,
    criteria: d.criteria,
    asset: d.asset,
    amount:
      d.asset === "NIM"
        ? Number(d.amountRaw) / NIM_DECIMALS
        : Number(d.amountRaw) / 1_000_000,
    deadline: d.deadline.toISOString(),
    status: d.status,
    verifierKind: d.verifierKind,
    verifierLink: d.verifierLink ?? null,
    verifierResult: d.verifierResult,
    proofImageUrl: d.proofImageUrl ?? null,
    createdAt: d.createdAt.toISOString(),
    escrowTxHash: d.escrowTxHash ?? null,
    payoutTxHash: d.payoutTxHash ?? null,
    payoutStatus: d.payoutStatus ?? null,
    funded: d.fundedAt !== null,
    escrow: escrowFor(d.asset),
  };
}

export function summaryToClient(s: LedgerSummary) {
  return {
    active: s.active,
    escrowedNim: Number(s.escrowedNim) / NIM_DECIMALS,
    escrowedUsdt: Number(s.escrowedUsdt) / 1_000_000,
    won: s.won,
    lost: s.lost,
  };
}

export function escrowToClient(b: EscrowBalanceRecord) {
  return {
    asset: b.asset,
    chain: b.chain,
    address: b.address,
    balance: (b.asset === "NIM" ? Number(b.balanceRaw) / NIM_DECIMALS : Number(b.balanceRaw) / 1_000_000),
    reserved: (b.asset === "NIM" ? Number(b.reservedRaw) / NIM_DECIMALS : Number(b.reservedRaw) / 1_000_000),
    updatedAt: b.updatedAt.toISOString(),
  };
}