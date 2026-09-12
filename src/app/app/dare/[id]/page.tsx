import { notFound } from "next/navigation";
import { getStore } from "@/lib/db";
import { dareToClient } from "@/lib/serialize";
import DareDetail from "./dare-detail";

export const dynamic = "force-dynamic";

export default async function DarePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const sharedStore = store.label !== "memory";
  const dare = sharedStore ? await store.getDare(id) : null;
  if (sharedStore && !dare) notFound();
  return <DareDetail id={id} initial={dare ? dareToClient(dare) : null} />;
}