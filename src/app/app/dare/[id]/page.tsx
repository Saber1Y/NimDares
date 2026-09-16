import { notFound } from "next/navigation";
import { getStore } from "@/lib/db";
import { dareToClient } from "@/lib/serialize";
import DareDetail from "./dare-detail";

export const dynamic = "force-dynamic";

export default async function DarePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code : null;
  const store = getStore();
  const sharedStore = store.label !== "memory";
  const dare = sharedStore ? await store.getDare(id) : null;
  if (sharedStore && !dare) notFound();

  // The server never pre-renders a private dare without the right to see it.
  // Solo dares are only fetched client-side with a wallet-bound signature;
  // team rooms pre-load for a valid invite code in the URL.
  let initial = null;
  if (dare) {
    const canPreload =
      !dare.isPrivate || (dare.roomCode !== null && code === dare.roomCode);
    if (canPreload) initial = dareToClient(dare, { includeRoomCode: canPreload });
  }
  return <DareDetail id={id} initial={initial} inviteCode={code} />;
}