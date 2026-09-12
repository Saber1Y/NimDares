"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Wallet,
  Activity,
  Coins,
} from "lucide-react";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { shortHash } from "@/lib/format";

type AdminData = {
  escrowWallets: {
    nim: { address: string | null; configured: boolean };
    evm: { address: string | null; configured: boolean };
  };
  balances: {
    asset: string;
    chain: string;
    address: string;
    balance: number;
    reserved: number;
    updatedAt: string;
  }[];
  transactions: {
    id: string;
    dareId: string | null;
    kind: string;
    chain: string;
    asset: string;
    amount: number;
    fromAddress: string | null;
    toAddress: string | null;
    txHash: string | null;
    status: string;
    createdAt: string;
  }[];
  summary: {
    active: number;
    escrowedNim: number;
    escrowedUsdt: number;
    won: number;
    lost: number;
  };
  store: string;
};

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function kindColor(kind: string): string {
  switch (kind) {
    case "ESCROW_DEPOSIT":
      return "text-emerald-400";
    case "PAYOUT":
      return "text-primary";
    case "SLASH_POOL":
      return "text-red-400";
    case "SWEEP":
      return "text-blue-400";
    default:
      return "text-muted-foreground";
  }
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error ?? "unknown error");
        setData(json);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      {/* header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Button href="/app" variant="ghost" className="px-0 text-muted-foreground">
          <ArrowLeft className="size-4" /> Console
        </Button>
        <div className="mt-5 flex items-center gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
            /admin/control-plane
          </p>
          {data && <StatusPill label={`STORE: ${data.store.toUpperCase()}`} tone="neutral" />}
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
          System internals
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Escrow balances, sweep history, and protocol health. For judges and operators.
        </p>
      </motion.div>

      {loading && (
        <p className="font-mono text-sm text-muted-foreground">&gt; reading admin ledger…</p>
      )}
      {error && (
        <div className="rounded-2xl border border-border bg-card/65 p-5">
          <p className="font-mono text-sm text-red-400">ERR: {error}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The admin endpoint may require CRON_SECRET set as x-admin-secret header.
          </p>
        </div>
      )}

      {data && (
        <>
          {/* summary metrics */}
          <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
            {[
              { label: "Active dares", value: String(data.summary.active) },
              { label: "Escrowed NIM", value: formatAmount(data.summary.escrowedNim) },
              { label: "Escrowed USDT", value: formatAmount(data.summary.escrowedUsdt) },
              { label: "Won", value: String(data.summary.won) },
              { label: "Lost", value: String(data.summary.lost) },
            ].map((m, i) => (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="border-t border-border pt-3"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {m.label}
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-primary">
                  {m.value}
                </p>
              </motion.div>
            ))}
          </div>

          {/* escrow wallets */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <HudPanel label="Escrow wallets" icon={<Wallet className="size-3.5" />}>
              <div className="flex flex-col gap-6">
                {(["nim", "evm"] as const).map((chain) => {
                  const w = data.escrowWallets[chain];
                  return (
                    <div key={chain} className="border-t border-border pt-4">
                      <div className="flex items-center gap-3">
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
                          {chain === "nim" ? "NIM (Nimiq)" : "USDT (Polygon)"}
                        </p>
                        <StatusPill
                          label={w.configured ? "CONFIGURED" : "NOT CONFIGURED"}
                          tone={w.configured ? "success" : "neutral"}
                        />
                      </div>
                      {w.address && (
                        <p className="mt-2 break-all font-mono text-sm text-foreground">
                          {w.address}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </HudPanel>
          </motion.div>

          {/* on-chain balances */}
          {data.balances.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <HudPanel label="On-chain escrow balances" icon={<Coins className="size-3.5" />} badge="REAL / LIVE">
                <div className="flex flex-col gap-4">
                  {data.balances.map((b, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
                            {b.asset}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {b.chain}
                          </span>
                        </div>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {b.address}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-lg font-semibold text-foreground">
                          {formatAmount(b.balance)}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          reserved: {formatAmount(b.reserved)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </HudPanel>
            </motion.div>
          )}

          {/* sweep / transaction history */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <HudPanel
              label="Transaction history"
              icon={<Activity className="size-3.5" />}
              badge={`${data.transactions.length} TX`}
            >
              {data.transactions.length === 0 ? (
                <p className="font-mono text-sm text-muted-foreground">
                  No transactions recorded yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <StatusPill label={tx.kind} tone="neutral" />
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {tx.asset} · {tx.chain}
                        </span>
                        <span className={`font-mono text-sm font-medium ${kindColor(tx.kind)}`}>
                          {tx.kind === "PAYOUT" ? "+" : ""}{formatAmount(tx.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        {tx.txHash && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            tx: {shortHash(tx.txHash)}
                          </span>
                        )}
                        <StatusPill
                          label={tx.status}
                          tone={tx.status === "CONFIRMED" ? "success" : tx.status === "FAILED" ? "failed" : "neutral"}
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </HudPanel>
          </motion.div>
        </>
      )}
    </div>
  );
}
