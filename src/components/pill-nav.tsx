"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";

const links = [
  { href: "#how", label: "How it works" },
  { href: "#proof", label: "Proof" },
  { href: "#verifiers", label: "Verifiers" },
];

export function PillNav() {
  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="fixed left-1/2 top-5 z-50 flex w-[min(920px,calc(100dvw-2rem))] -translate-x-1/2 items-center justify-between rounded-full border border-border bg-card/70 px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-xl md:px-5"
    >
      <Link href="/" className="flex items-center gap-3 font-mono text-sm tracking-[0.16em]">
        <BrandMark className="size-7 shadow-[0_0_18px_rgb(233_178_19_/_0.24)]" />
        NIMDARES
      </Link>
      <nav className="hidden items-center gap-1 text-sm text-muted-foreground lg:flex">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="px-4 py-2 transition-colors hover:text-foreground"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <Button href="/app" variant="secondary">
        Launch app
      </Button>
    </motion.header>
  );
}
