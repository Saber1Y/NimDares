import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { confirmNimFunding } from "@/lib/escrow/confirm";
import { dareToClient, participantToClient } from "@/lib/serialize";
import type { DareRecord } from "@/lib/db";

/** Unsettled seats re-checked per read, so one slow room cannot fan out RPC calls. */
const MAX_SEAT_CHECKS = 5;

/**
 * A deposit with no claimed transaction (someone transferred to the escrow
 * address by hand) can only be found by scanning escrow, which is far more
 * expensive than a hash lookup. Throttled per stake so a page that refreshes
 * every few seconds does not scan on every read.
 */
const SCAN_INTERVAL_MS = 30_000;
const lastScan = new Map<string, number>();

function mayScan(key: string): boolean {
  const now = Date.now();
  const previous = lastScan.get(key) ?? 0;
  if (now - previous < SCAN_INTERVAL_MS) return false;
  lastScan.set(key, now);
  return true;
}

/**
 * Settles deposits that were not yet in a block when the payment came back from
 * Nimiq Pay. Nothing runs in the background, so the read is what catches up.
 */
async function settlePendingFunding(dare: DareRecord): Promise<boolean> {
  if (dare.asset !== "NIM") return false;
  const store = getStore();

  if (dare.maxCapacity > 1) {
    const seats = (await store.listParticipants(dare.id))
      .filter((p) => !p.fundedAt)
      .slice(0, MAX_SEAT_CHECKS);
    let settled = false;
    for (const seat of seats) {
      // A claimed hash is a cheap lookup; only an unclaimed seat needs a scan.
      const scan = !seat.fundingTxHash && mayScan(seat.id);
      if (!seat.fundingTxHash && !scan) continue;
      const result = await confirmNimFunding(dare.id, { participantId: seat.id, scan });
      if (result.status === "funded") settled = true;
    }
    return settled;
  }

  if (dare.status !== "PENDING_FUNDING" || dare.fundedAt) return false;
  const scan = !dare.escrowTxHash && mayScan(dare.id);
  if (!dare.escrowTxHash && !scan) return false;
  const result = await confirmNimFunding(dare.id, { scan });
  return result.status === "funded";
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const store = getStore();
  let dare = await store.getDare(id);
  if (!dare) {
    return NextResponse.json({ ok: false, error: "dare not found" }, { status: 404 });
  }

  if (await settlePendingFunding(dare)) {
    dare = (await store.getDare(id)) ?? dare;
  }

  const participants =
    dare.maxCapacity > 1 ? (await store.listParticipants(id)).map(participantToClient) : [];
  return NextResponse.json({
    ok: true,
    dare: dareToClient(dare),
    participants,
    store: store.label,
  });
}
