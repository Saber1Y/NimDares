import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { dareToClient } from "@/lib/serialize";

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
  return NextResponse.json({ ok: true, dare: dareToClient(dare), store: store.label });
}