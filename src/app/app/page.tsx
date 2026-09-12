"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowRight,
  Plus,
  Wallet,
  CircleAlert,
  Swords,
  Hourglass,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useNimiqWallet } from "@/components/nimiq-provider";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { timeLeft } from "@/lib/format";
import type { Dare, LedgerSummary } from "@/lib/types";

type ApiState = {
  status: "loading" | "ok" | "unavailable";
  dares: Dare[];
  summary: LedgerSummary | null;
};

type ReconcileState = { phase: "idle" } | { phase: "reconciling" } | { phase: "done"; message: string };

export default function Dashboard() {
  const { status: walletStatus, address, network, error } = useNimiqWallet();
  const [api, setApi] = useState<ApiState>({
    status: "loading",
    dares: [],
    summary: null,
  });
  const [reconcile, setReconcile] = useState<ReconcileState>({ phase: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = address ? `?owner=${encodeURIComponent(address)}` : "";
      try {
        const res = await fetch(`/api/dares${q}`, { cache: "no-store" });
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
  }, [address]);

  const runReconcile = useCallback(async () => {
    if (!address || walletStatus !== "ready") return;
    setReconcile({ phase: "reconciling" });
    try {
      const res = await fetch("/api/wallet/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset: "NIM", address }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setReconcile({ phase: "done", message: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      const ledgerBal = data.reconciled
        ? `${(Number(data.ledger) / 100_000).toFixed(2)} NIM`
        : "N/A";
      setReconcile({
        phase: "done",
        message: `on-chain: ${data.reconciled ? ledgerBal : "unreachable"} · store: ${data.store}`,
      });
    } catch (e) {
      setReconcile({ phase: "done", message: e instanceof Error ? e.message : String(e) });
    }
  }, [address, walletStatus]);

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
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
            /operator-console
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
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
          <Button href="/app/admin" variant="ghost">
            <Shield className="size-4" /> Admin
          </Button>
        </div>
      </motion.div>

      {/* wallet HUD */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel
          label="Wallet link"
          icon={<Wallet className="size-3.5" />}
          badge={walletStatus === "ready" ? "REAL / LIVE" : undefined}
        >
          {walletStatus === "initializing" && (
            <p className="font-mono text-sm text-muted-foreground">
              &gt; waiting for Nimiq Pay host… <span className="nd-live-dot ml-1 inline-block size-1.5 rounded-full align-middle" />
            </p>
          )}
          {walletStatus === "ready" && (
            <div className="grid gap-6 md:grid-cols-3">
              <div className="border-t border-border pt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Address</p>
                <p className="mt-3 break-all font-mono text-sm text-foreground">{address}</p>
              </div>
              <div className="border-t border-border pt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Network</p>
                <p className="mt-3 font-mono text-sm text-primary">{network ?? "nimiq"}</p>
              </div>
              <div className="border-t border-border pt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Account</p>
                <p className="mt-3 font-mono text-sm text-foreground">linked &amp; signing</p>
              </div>
            </div>
          )}
          {walletStatus === "ready" && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => void runReconcile()}
                  disabled={reconcile.phase === "reconciling"}
                >
                  <RefreshCw className={`size-4 ${reconcile.phase === "reconciling" ? "animate-spin" : ""}`} />
                  {reconcile.phase === "reconciling" ? "Reconciling…" : "Reconcile on-chain balance"}
                </Button>
                {reconcile.phase === "done" && (
                  <StatusPill label={reconcile.message} tone="neutral" />
                )}
              </div>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                &gt; refreshes the escrow ledger from the live Nimiq/Polygon chain
              </p>
            </div>
          )}
          {walletStatus === "no-host" && (
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="max-w-xl">
                <p className="text-sm font-medium text-foreground">
                  Development mode - Nimiq Pay host not detected.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  `window.nimiq` is undefined outside the Pay mini-app shell.
                  NIM funding is unavailable here. USDT funding falls back to
                  the browser EVM bridge on {error ? "error" : "Amoy"} when
                  MetaMask is installed.
                </p>
                {error && (
                  <p className="mt-2 font-mono text-[11px] text-red-400">ERR: {error}</p>
                )}
              </div>
              <StatusPill label="DEV / SIMULATED" tone="neutral" />
            </div>
          )}
          {walletStatus === "error" && (
            <div className="flex items-center gap-3">
              <CircleAlert className="size-4 text-red-400" />
              <p className="font-mono text-sm text-red-400">WALLET ERROR: {error}</p>
            </div>
          )}
        </HudPanel>
      </motion.div>

      {/* metric row */}
      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        {[
          { label: "Active dares", value: api.summary ? String(api.summary.active) : null },
          { label: "Escrowed NIM", value: api.summary ? api.summary.escrowedNim.toFixed(2) : null },
          { label: "Escrowed USDT", value: api.summary ? api.summary.escrowedUsdt.toFixed(2) : null },
          { label: "Resolved", value: api.summary ? String(api.summary.won + api.summary.lost) : null },
        ].map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="border-t border-border pt-3"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{m.label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-primary">
              {m.value ?? "—"}
            </p>
          </motion.div>
        ))}
      </div>

      {/* dare ledger */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel
          label="Dare ledger"
          icon={<Swords className="size-3.5" />}
          badge={api.status === "ok" ? "LEDGER / SYNCED" : undefined}
        >
          {api.status === "loading" && (
            <p className="font-mono text-sm text-muted-foreground">&gt; syncing ledger…</p>
          )}
          {api.status === "unavailable" && (
            <EmptyLedger
              icon={<Hourglass className="size-6 text-muted-foreground" />}
              title="Ledger offline"
              body="No dares service is reachable. API routes are not deployed or DATABASE_URL is unset. Resolve once the backend is running."
            />
          )}
          {api.status === "ok" && api.dares.length === 0 && (
            <EmptyLedger
              icon={<Swords className="size-6 text-muted-foreground" />}
              title="No dares on the ledger"
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

function EmptyLedger({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
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
      className="group flex flex-col gap-4 rounded-2xl border border-border bg-[#09090b]/60 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 md:flex-row md:items-center md:justify-between"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <p className="truncate font-medium text-foreground">{dare.title}</p>
          <StatusPill label={dare.status} tone={tone} live={tone === "live"} />
        </div>
        <p className="mt-1 line-clamp-1 font-mono text-[11px] text-muted-foreground">
          {dare.asset} · {dare.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} · verifier {dare.verifierKind} · {timeLeft(dare.deadline)}
        </p>
      </div>
      <div className="flex items-center gap-3 md:shrink-0">
        {dare.funded ? (
          <StatusPill
            label={dare.verifierResult?.status ?? "WAITING"}
            tone={dare.verifierResult?.status === "VALID" ? "success" : dare.verifierResult?.status === "INVALID" ? "failed" : "neutral"}
          />
        ) : (
          <StatusPill label="NEEDS FUNDING" tone="neutral" />
        )}
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </div>
    </Link>
  );
}