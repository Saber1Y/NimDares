import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { fetchNimBalance } from "@/lib/escrow/nim";
import { fetchUsdtBalance } from "@/lib/escrow/evm";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    asset?: "NIM" | "USDT";
    address?: string;
  } | null;
  const asset = body?.asset;
  const address = body?.address;
  if (!asset || !address || (asset !== "NIM" && asset !== "USDT")) {
    return NextResponse.json({ ok: false, error: "asset and address required" }, { status: 400 });
  }

  const chain = asset === "NIM" ? "NIM" : "EVM";
  const store = getStore();
  const current = await store.getEscrowBalance(asset, chain, address);
  let onChain: bigint | null = null;
  let error: string | null = null;
  try {
    onChain = asset === "NIM" ? await fetchNimBalance(address) : await fetchUsdtBalance(address);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let row = current;
  if (onChain !== null) {
    const delta = onChain - current.balanceRaw;
    if (delta !== 0n) {
      row = await store.bumpEscrowBalance(asset, chain, address, delta);
    }
  }

  return NextResponse.json({
    ok: true,
    asset,
    chain,
    address,
    onChain: onChain?.toString() ?? null,
    ledger: row.balanceRaw.toString(),
    reserved: row.reservedRaw.toString(),
    reconciled: onChain !== null,
    error,
    store: store.label,
  });
}