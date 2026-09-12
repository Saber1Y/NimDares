"use client";

import type { ReactNode } from "react";
import { NimiqWalletProvider } from "@/components/nimiq-provider";
import { AppNav } from "@/components/app-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <NimiqWalletProvider>
      <AppNav />
      <div className="mx-auto max-w-[1160px] px-5 pb-20 pt-28 md:px-10">{children}</div>
    </NimiqWalletProvider>
  );
}