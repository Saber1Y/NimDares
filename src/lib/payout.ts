"server-only";

import type { DareRecord } from "@/lib/db";
import { buildNimSweepTx, getNimEscrowInfo } from "@/lib/escrow/nim";
import { getEvmEscrowInfo, sendUsdtPayout } from "@/lib/escrow/evm";
import { NIM_DECIMALS } from "@/lib/config";

export interface PayoutResult {
  status: "SETTLED" | "PENDING" | "FAILED";
  txHash?: string;
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