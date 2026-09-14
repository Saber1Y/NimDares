import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { confirmNimFunding } from "@/lib/escrow/confirm";

const strip = (a: string) => a.replace(/\s+/g, "");

/** Lookups before leaving the deposit pending; Nimiq blocks are ~1s apart. */
const CONFIRM_ATTEMPTS = 3;

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

  // A room seat is funded by its own holder; a solo stake only by the owner.
  const isRoom = dare.maxCapacity > 1;
  if (!isRoom && strip(auth.address!) !== strip(dare.ownerAddress)) {
    return NextResponse.json({ ok: false, error: "not your dare" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    asset?: string;
    txRef?: string;
    participantId?: string;
  } | null;

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

  const result = await confirmNimFunding(id, {
    txRef: body?.txRef,
    participantId: body?.participantId,
    payerAddress: auth.address,
    attempts: CONFIRM_ATTEMPTS,
  });

  if (result.status === "rejected") {
    return NextResponse.json(
      { ok: false, status: result.status, error: result.error, txHash: result.txHash },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, status: result.status, txHash: result.txHash });
}
