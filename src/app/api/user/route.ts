import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { dareToClient } from "@/lib/serialize";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ ok: false, error: "address query param required" }, { status: 400 });
  }
  const store = getStore();
  const user = await store.getOrCreateUser(address);
  const dares = (await store.listDares(address)).map(dareToClient);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, address: user.address },
    dareCount: dares.length,
    dares,
    store: store.label,
  });
}