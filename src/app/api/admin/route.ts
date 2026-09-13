import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getNimEscrowInfo, getNimCharityAddress, getNimCommunityTreasuryAddress } from "@/lib/escrow/nim";
import { getEvmEscrowInfo } from "@/lib/escrow/evm";
import { escrowToClient } from "@/lib/serialize";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("x-admin-secret");
  if (secret && authHeader !== secret) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const store = getStore();
  const [balances, txs, summary] = await Promise.all([
    store.listEscrowBalances(),
    store.listTransactions(50),
    store.summary(),
  ]);

  const nimEscrow = getNimEscrowInfo();
  const evmEscrow = getEvmEscrowInfo();

  return NextResponse.json({
    ok: true,
    escrowWallets: {
      nim: { address: nimEscrow.address || null, configured: nimEscrow.configured },
      evm: { address: evmEscrow.address || null, configured: evmEscrow.configured },
    },
    treasury: {
      charityAddress: getNimCharityAddress() ?? null,
      communityTreasuryAddress: getNimCommunityTreasuryAddress() ?? null,
      network: nimEscrow.network,
    },
    balances: balances.map(escrowToClient),
    transactions: txs.map((t) => ({
      id: t.id,
      dareId: t.dareId,
      kind: t.kind,
      chain: t.chain,
      asset: t.asset,
      amount: t.asset === "NIM"
        ? Number(t.amountRaw) / 100_000
        : Number(t.amountRaw) / 1_000_000,
      fromAddress: t.fromAddress,
      toAddress: t.toAddress,
      txHash: t.txHash,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    })),
    summary: {
      active: summary.active,
      escrowedNim: Number(summary.escrowedNim) / 100_000,
      escrowedUsdt: Number(summary.escrowedUsdt) / 1_000_000,
      won: summary.won,
      lost: summary.lost,
    },
    store: store.label,
  });
}
