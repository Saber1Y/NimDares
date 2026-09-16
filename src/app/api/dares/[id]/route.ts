import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { confirmNimFunding } from "@/lib/escrow/confirm";
import { dareToClient, participantToClient } from "@/lib/serialize";
import type { DareRecord } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { cancelDare, CancelError } from "@/lib/cancel";

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
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const store = getStore();
  let dare = await store.getDare(id);
  if (!dare) {
    return NextResponse.json({ ok: false, error: "dare not found" }, { status: 404 });
  }

  // Reads are gated. Arena rooms are public; solo dares exist only for their
  // owner; team rooms open to authorized wallets or to anyone holding the
  // invite code. Identity is optional here, so a missing header is a guest,
  // not an error.
  const auth = await authenticate(req);
  const viewer = auth.ok ? auth.address! : null;
  const participants =
    dare.maxCapacity > 1 ? await store.listParticipants(id) : [];

  const isArena = !dare.isPrivate;
  const isOwner = viewer !== null && viewer === dare.ownerAddress;
  const isParticipant =
    viewer !== null && participants.some((p) => p.userAddress === viewer);
  const hasCode =
    dare.roomCode !== null && req.nextUrl.searchParams.get("code") === dare.roomCode;
  const authorized = isArena || isOwner || isParticipant || hasCode;

  if (!authorized) {
    // Team rooms are shared by link, so revealing that a room exists is fine;
    // joining still requires the code. The client turns this into the invite
    // entrance rather than a "not found" screen.
    if (dare.isPrivate && dare.maxCapacity > 1) {
      return NextResponse.json(
        { ok: false, error: "this room needs its invite code", codeRequired: true },
        { status: 403 },
      );
    }
    // Solo: hide existence entirely.
    return NextResponse.json({ ok: false, error: "dare not found" }, { status: 404 });
  }

  if (await settlePendingFunding(dare)) {
    dare = (await store.getDare(id)) ?? dare;
  }

  return NextResponse.json({
    ok: true,
    dare: dareToClient(dare, { includeRoomCode: authorized }),
    participants: participants.map(participantToClient),
    store: store.label,
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await ctx.params;
  try {
    const result = await cancelDare(id, auth.address!);
    if (result.kind === "deleted") {
      return NextResponse.json({ ok: true, deleted: true, dareId: result.dareId, refunds: [], store: getStore().label });
    }
    return NextResponse.json({
      ok: true,
      deleted: false,
      dare: dareToClient(result.dare, { includeRoomCode: true }),
      refunds: result.refunds.map((refund) => ({
        ...refund,
        amountRaw: refund.amountRaw.toString(),
      })),
      store: getStore().label,
    });
  } catch (error) {
    if (!(error instanceof CancelError)) throw error;
    const status = error.message === "dare not found" ? 404 : error.message.startsWith("only the dare creator") ? 403 : 409;
    return NextResponse.json({ ok: false, error: error.message }, { status });
  }
}
