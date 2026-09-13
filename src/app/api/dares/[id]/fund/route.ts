import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { fetchNimIncomingTxs, getNimEscrowInfo } from "@/lib/escrow/nim";
import { dareToClient, participantToClient } from "@/lib/serialize";

const strip = (a: string) => a.replace(/\s+/g, "");

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await ctx.params;
  const store = getStore();
  const dare = await store.getDare(id);
  if (!dare) {
    return NextResponse.json({ ok: false, error: "dare not found" }, { status: 404 });
  }
  if (strip(auth.address!) !== strip(dare.ownerAddress)) {
    return NextResponse.json({ ok: false, error: "not your dare" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { asset?: string } | null;
  if (body?.asset && body.asset !== "NIM") {
    return NextResponse.json(
      { ok: false, error: "on-chain funding is only supported for NIM escrow" },
      { status: 400 }
    );
  }
  if (dare.asset !== "NIM") {
    return NextResponse.json(
      { ok: false, error: "this dare uses USDT escrow; fund it manually" },
      { status: 400 }
    );
  }

  const escrow = getNimEscrowInfo();
  if (!escrow.configured) {
    return NextResponse.json({ ok: false, error: "NIM escrow is not configured" }, { status: 503 });
  }

  let txs: Awaited<ReturnType<typeof fetchNimIncomingTxs>> = [];
  try {
    // Pay may return immediately while the public testnet RPC is still indexing the tx.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      txs = await fetchNimIncomingTxs(escrow.address);
      if (txs.some((tx) => tx.value === dare.amountRaw)) break;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  let credited = 0;
  let activated = false;

  if (dare.maxCapacity > 1) {
    const seats = await store.listParticipants(dare.id);
    for (const tx of txs) {
      if (!tx.memo) continue;
      const parts = tx.memo.split(":");
      if (parts.length !== 3 || parts[0] !== "nimdares" || parts[1] !== dare.id) continue;
      const seat = seats.find((p) => p.id === parts[2]);
      if (!seat || seat.fundedAt || seat.stakeRaw !== tx.value) continue;
      await store.updateParticipant(seat.id, { fundingTxHash: tx.hash, fundedAt: new Date() });
      credited += 1;
    }
    // The room goes live once at least one seat is funded, matching the lobby rule;
    // unfunded seats are settled as INVALID at the deadline.
    if (credited > 0 && dare.status === "LOBBY") {
      await store.updateDare(dare.id, { status: "ACTIVE", fundedAt: new Date() });
      activated = true;
    }
  } else {
    // Solo: match the creator's own deposit into the escrow by owner + exact amount,
    // preferring the nimdares:<id>:<owner> memo when present.
    const wantMemo = `nimdares:${dare.id}:${strip(dare.ownerAddress)}`;
    for (const tx of txs) {
      if (strip(tx.fromAddress) !== strip(dare.ownerAddress)) continue;
      if (tx.value !== dare.amountRaw) continue;
      if (tx.memo && tx.memo !== wantMemo) continue;
      await store.updateDare(dare.id, {
        status: "ACTIVE",
        fundedAt: new Date(),
        escrowTxHash: tx.hash,
      });
      credited += 1;
      activated = true;
      break;
    }
  }

  const updated = await store.getDare(id);
  const participants =
    dare.maxCapacity > 1 ? (await store.listParticipants(dare.id)).map(participantToClient) : [];

  return NextResponse.json({
    ok: true,
    credited,
    activated,
    status: updated?.status ?? dare.status,
    funded: updated?.fundedAt != null,
    dare: updated ? dareToClient(updated) : undefined,
    participants,
    store: store.label,
  });
}
