import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { dareToClient, participantToClient } from "@/lib/serialize";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const store = getStore();
  const dare = await store.getDare(id);
  if (!dare) {
    return NextResponse.json({ ok: false, error: "dare not found" }, { status: 404 });
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