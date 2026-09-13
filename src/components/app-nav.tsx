"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useNimiqWallet } from "@/components/nimiq-provider";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/brand-mark";

export function AppNav() {
  const { address, status, network } = useNimiqWallet();
  const pathname = usePathname();

  const navLinks = [
    { href: "/app", label: "Dares", active: pathname === "/app" || pathname === "/app/" },
    { href: "/app/create", label: "Create", active: pathname.startsWith("/app/create") },
  ];

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="fixed left-1/2 top-5 z-50 flex w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between rounded-full border border-border bg-card/70 px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-xl md:px-5"
    >
      <Link href="/app" className="flex items-center gap-3 font-mono text-sm tracking-[0.16em]">
        <BrandMark className="size-7 shadow-[0_0_18px_rgb(233_178_19_/_0.24)]" />
        NIMDARES
      </Link>

      <nav className="hidden items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground lg:flex">
        {navLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={l.active ? "page" : undefined}
            className={cn(
              "px-4 py-2 transition-colors hover:text-foreground",
              l.active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <StatusPill
          label={
            status === "ready"
              ? `${network ?? "NIM"} · ${address?.slice(0, 6)}…`
              : status === "no-host"
                ? "DEV / NO HOST"
                : status.toUpperCase()
          }
          tone={status === "ready" ? "live" : status === "no-host" ? "neutral" : "failed"}
          live={status === "ready"}
        />
      </div>
    </motion.header>
  );
}
