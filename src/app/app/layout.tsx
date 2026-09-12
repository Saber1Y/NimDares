import type { ReactNode } from "react";
import { DotGrid } from "@/components/ui/dot-grid";
import { AppShell } from "@/components/app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#09090b] text-foreground">
      <DotGrid />
      <div className="relative z-10">
        <AppShell>{children}</AppShell>
      </div>
    </main>
  );
}