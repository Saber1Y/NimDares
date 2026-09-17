"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowRight,
  Plus,
  Swords,
  Wallet,
  Hourglass,
  Globe,
  Users,
} from "lucide-react";
import { useNimiqWallet } from "@/components/nimiq-provider";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dareStatusLabel, verdictLabel } from "@/lib/labels";
import { timeLeft, shortHash } from "@/lib/format";
import type { Dare, LedgerSummary } from "@/lib/types";

// Browser-native base64url encoding. `Buffer` is polyfilled by Next.js but
type ApiState = {
  status: "loading" | "ok" | "unavailable";
  dares: Dare[];
  summary: LedgerSummary | null;
};


export default function Dashboard() {
  const { status: walletStatus, address, readAuth, signIn } = useNimiqWallet();
  const [api, setApi] = useState<ApiState>({
    status: "loading",
    dares: [],
    summary: null,
  });
  const [rooms, setRooms] = useState<Dare[]>([]);
  const [signingIn, setSigningIn] = useState(false);

  // The owner-scoped list is only readable by the wallet that owns the
  // address. Signing is user-triggered (wallet dialogs require a user
  // gesture and firing one automatically on mount is rejected by the host),
  // so the dashboard loads the public arena + summary first and dares fill
  // in once the user signs in. The read credential is persisted per wallet in
  // the wallet provider, so this prompt appears once, not on every visit.
  const signInOnce = useCallback(async () => {
    if (walletStatus !== "ready" || !address || readAuth || signingIn) return;
    setSigningIn(true);
    await signIn();
    setSigningIn(false);
  }, [walletStatus, address, readAuth, signingIn, signIn]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = address && readAuth ? `?owner=${encodeURIComponent(address)}` : "";
      try {
        const res = await fetch(`/api/dares${q}`, {
          cache: "no-store",
          headers: readAuth ? { authorization: readAuth } : undefined,
        });
        if (!res.ok) throw new Error(`api ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setApi({ status: "ok", dares: data.dares ?? [], summary: data.summary ?? null });
      } catch {
        if (cancelled) return;
        setApi({ status: "unavailable", dares: [], summary: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, readAuth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dares?mode=open", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRooms(data.rooms ?? []);
      } catch {
        /* arena feed is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      {/* header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap items-end justify-between gap-6"
      >
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
            Your dares
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Commitments you have staked. Every one resolves through evidence,
            never a handshake.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button href="/app/create">
            New dare <Plus className="size-4" />
          </Button>
        </div>
      </motion.div>

      {/* metric row */}
      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        {[
          { label: "Active dares", value: api.summary ? String(api.summary.active) : null },
          { label: "NIM at stake", value: api.summary ? api.summary.escrowedNim.toFixed(2) : null },
          { label: "Resolved", value: api.summary ? String(api.summary.won + api.summary.lost) : null },
          {
            label: "Total transactions",
            value: api.summary ? api.summary.transactions.toLocaleString("en-US") : null,
          },
        ].map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="border-t border-border pt-3"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{m.label}</p>
            {m.value !== null ? (
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-primary">
                {m.value}
              </p>
            ) : (
              <Skeleton className="mt-3 h-8 w-20" />
            )}
          </motion.div>
        ))}
      </div>

      {/* arena feed */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel
          label="Arena"
          icon={<Globe className="size-3.5" />}
          badge={rooms.length > 0 ? `${rooms.length} OPEN` : undefined}
        >
          {rooms.length === 0 && api.status !== "loading" ? (
            <EmptyLedger
              icon={<Globe className="size-6 text-muted-foreground" />}
              title="No open tables"
              body="Public arena rooms appear here for anyone to join. Create one yourself and the arena fills from the community."
            />
          ) : rooms.length === 0 && api.status === "loading" ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <RoomCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {rooms.map((d) => (
                <RoomCard key={d.id} dare={d} />
              ))}
            </div>
          )}
        </HudPanel>
      </motion.div>

      {/* dare ledger */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel
          label="Your dares"
          icon={<Swords className="size-3.5" />}
          badge={api.status === "ok" ? "UP TO DATE" : undefined}
        >
          {api.status === "loading" && (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <DareRowSkeleton key={i} />
              ))}
            </div>
          )}
          {api.status === "unavailable" && (
            <EmptyLedger
              icon={<Hourglass className="size-6 text-muted-foreground" />}
              title="Ledger offline"
              body="No dares service is reachable. API routes are not deployed or DATABASE_URL is unset. Resolve once the backend is running."
            />
          )}
          {api.status === "ok" && walletStatus === "ready" && !readAuth && (
            <EmptyLedger
              icon={<Wallet className="size-6 text-muted-foreground" />}
              title="Sign in to see your dares"
              body="Your wallet is connected. Sign a read credential so NimDares can show the dares you own. You only sign once per wallet."
              action={
                <Button onClick={() => void signInOnce()} disabled={signingIn}>
                  {signingIn ? "Signing in…" : "Sign in"}
                </Button>
              }
            />
          )}
          {api.status === "ok" && api.dares.length === 0 && readAuth && (
            <EmptyLedger
              icon={<Swords className="size-6 text-muted-foreground" />}
              title="No dares yet"
              body="Your first dare is one stake away. Escrow opens the moment funding lands."
            />
          )}
          {api.status === "ok" && api.dares.length > 0 && (
            <div className="flex flex-col gap-4">
              {api.dares.map((d) => (
                <DareRow key={d.id} dare={d} />
              ))}
            </div>
          )}
        </HudPanel>
      </motion.div>
    </div>
  );
}

function RoomCard({ dare }: { dare: Dare }) {
  const live = dare.status === "LOBBY" || dare.status === "ACTIVE";
  return (
    <Link
      href={`/app/dare/${dare.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-background/60 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 md:flex-row md:items-center md:justify-between"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <p className="truncate font-medium text-foreground">{dare.title}</p>
          <StatusPill label={dareStatusLabel(dare.status)} tone={live ? "live" : "neutral"} live={live} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-muted-foreground">
          <span>{dare.asset} · {dare.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} · {timeLeft(dare.deadline)}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">by {shortHash(dare.ownerAddress, 6)}</span>
        </p>
      </div>
      <div className="flex items-center gap-3 md:shrink-0">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <Users className="size-3.5" />
          {dare.maxCapacity} players
        </span>
        <span className="hidden font-mono text-[11px] text-primary md:inline">JOIN</span>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </div>
    </Link>
  );
}

function EmptyLedger({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted/30">
        {icon}
      </div>
      <div>
        <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-foreground">{title}</p>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

function DareRow({ dare }: { dare: Dare }) {
  const tone =
    dare.status === "WON"
      ? "success"
      : dare.status === "LOST"
        ? "failed"
        : dare.status === "ACTIVE" || dare.status === "PENDING_FUNDING"
          ? "live"
          : "neutral";
  return (
    <Link
      href={`/app/dare/${dare.id}`}
      className="group flex flex-col gap-4 rounded-2xl border border-border bg-background/60 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 md:flex-row md:items-center md:justify-between"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <p className="truncate font-medium text-foreground">{dare.title}</p>
          {dare.maxCapacity > 1 && (
            <StatusPill label={dare.isPrivate ? "TEAM" : "ARENA"} tone="neutral" />
          )}
          <StatusPill label={dareStatusLabel(dare.status)} tone={tone} live={tone === "live"} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-muted-foreground">
          <span>{dare.asset} · {dare.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}per seat · {timeLeft(dare.deadline)}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">by {shortHash(dare.ownerAddress, 6)}</span>
        </p>
      </div>
      <div className="flex items-center gap-3 md:shrink-0">
        {dare.funded ? (
          <StatusPill
            label={verdictLabel(dare.verifierResult?.status ?? "WAITING")}
            tone={dare.verifierResult?.status === "VALID" ? "success" : dare.verifierResult?.status === "INVALID" ? "failed" : "neutral"}
          />
        ) : dare.status === "PENDING_FUNDING" ? (
          <StatusPill label="CONFIRMING" tone="live" live />
        ) : (
          <StatusPill label="NEEDS FUNDING" tone="neutral" />
        )}
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </div>
    </Link>
  );
}

function DareRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background/60 p-5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-3.5 w-72" />
      </div>
      <div className="flex items-center gap-3 md:shrink-0">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="size-4" />
      </div>
    </div>
  );
}

function RoomCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background/60 p-5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-3.5 w-64" />
      </div>
      <div className="flex items-center gap-3 md:shrink-0">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="size-4" />
      </div>
    </div>
  );
}
