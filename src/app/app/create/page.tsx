"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, GitBranch, Bike, Plus, Wallet, CircleAlert, Check, ImageIcon, Users, Globe, Hash, Copy } from "lucide-react";
import { useNimiqWallet } from "@/components/nimiq-provider";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { Asset, RoomMode, VerifierKind } from "@/lib/types";

type FundStep = "funding" | "paid" | "cancelled" | "failed";

type CreateState =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "submitting" }
  | {
      phase: "created";
      step: FundStep;
      error: string | null;
      escrowAddress: string | null;
      escrowConfigured: boolean;
      asset: Asset;
      amount: number;
      mode: RoomMode;
      maxCapacity: number;
      roomCode: string | null;
      dareId: string;
      participantId: string | null;
    }
  | { phase: "error"; message: string };

const VERIFIERS: { kind: VerifierKind; label: string; icon: typeof ImageIcon; hint: string }[] = [
  { kind: "VISION", label: "Screenshot proof", icon: ImageIcon, hint: "AI judge verifies an image proof" },
  { kind: "GITHUB", label: "GitHub activity", icon: GitBranch, hint: "Proof is your public commit history" },
  { kind: "STRAVA", label: "Strava activity", icon: Bike, hint: "Proof is a public activity link" },
];

const MODES: { mode: RoomMode; label: string; icon: typeof Users; hint: string }[] = [
  { mode: "solo", label: "Solo", icon: Hash, hint: "One commitment, one stake, one verdict" },
  { mode: "team", label: "Team", icon: Users, hint: "A private room your circle joins by invite code" },
  { mode: "arena", label: "Arena", icon: Globe, hint: "A public table anyone can join from the arena feed" },
];

function base64UrlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function CreateDare() {
  const wallet = useNimiqWallet();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [asset, setAsset] = useState<Asset>("NIM");
  const [amount, setAmount] = useState("1");
  const [deadline, setDeadline] = useState("");
  const [verifier, setVerifier] = useState<VerifierKind>("VISION");
  const [verifierLink, setVerifierLink] = useState("");
  const [mode, setMode] = useState<RoomMode>("solo");
  const [capacity, setCapacity] = useState("5");
  const [state, setState] = useState<CreateState>({ phase: "idle" });

  const needsLink = verifier === "GITHUB" || verifier === "STRAVA";

  async function stakeAndFund(
    created: Extract<CreateState, { phase: "created" }>,
    authHeader: string
  ) {
    if (created.asset !== "NIM" || !created.escrowAddress) {
      setState({ ...created, step: "failed", error: "native payment is only for NIM escrow" });
      return;
    }
    const memoId = created.participantId ?? wallet.address!.replace(/\s+/g, "");
    const memo = `nimdares:${created.dareId}:${memoId}`;
    const valueLuna = Math.round(created.amount * 100_000);
    const res = await wallet.sendPayTransaction(created.escrowAddress, valueLuna, memo);
    if (!res.ok) {
      setState({ ...created, step: "cancelled", error: res.error ?? null });
      return;
    }
    try {
      const fund = await fetch(`/api/dares/${created.dareId}/fund`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({ asset: created.asset }),
      });
      const data = (await fund.json()) as { ok?: boolean; credited?: number; error?: string };
      if (!fund.ok || !data.ok || !data.credited) {
        setState({ ...created, step: "failed", error: data.error ?? "payment not confirmed on-chain yet" });
        return;
      }
      setState({ ...created, step: "paid" });
    } catch (e) {
      setState({ ...created, step: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleCreate() {
    if (!wallet.address || wallet.status !== "ready") {
      setState({ phase: "error", message: "wallet not connected; cannot sign the creation proof" });
      return;
    }
    if (!title.trim() || !description.trim() || !criteria.trim() || !amount || !deadline) {
      setState({ phase: "error", message: "all fields are required" });
      return;
    }
    if (needsLink && !verifierLink.trim()) {
      setState({ phase: "error", message: "a verifier link is required for this verifier" });
      return;
    }

    const message = `nimdares:create:${Date.now()}:${title.trim().slice(0, 40)}`;
    setState({ phase: "signing" });
    const sig = await wallet.signMessage(message);
    if (!sig) {
      setState({ phase: "error", message: "wallet signature failed or was rejected" });
      return;
    }

    setState({ phase: "submitting" });
    const authHeader = `Nimiq ${sig.publicKey}:${sig.signature}:${base64UrlEncode(message)}`;
    try {
      const res = await fetch("/api/dares", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          criteria: criteria.trim(),
          asset,
          amount: Number(amount),
          deadline: new Date(deadline).toISOString(),
          verifierKind: verifier,
          verifierLink: needsLink ? verifierLink.trim() : undefined,
          mode,
          maxCapacity: mode === "solo" ? undefined : Number(capacity),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        escrow?: { address: string | null; configured: boolean };
        dare?: { id: string; maxCapacity: number; roomCode: string | null };
        participants?: { id: string }[];
      };
      if (!res.ok || !data.ok) {
        setState({ phase: "error", message: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      const created: Extract<CreateState, { phase: "created" }> = {
        phase: "created",
        step: asset === "NIM" ? "funding" : "cancelled",
        error: null,
        escrowAddress: data.escrow?.address ?? null,
        escrowConfigured: data.escrow?.configured ?? false,
        asset,
        amount: Number(amount),
        mode,
        maxCapacity: data.dare?.maxCapacity ?? 1,
        roomCode: data.dare?.roomCode ?? null,
        dareId: data.dare?.id ?? "",
        participantId: data.participants?.[0]?.id ?? null,
      };
      setState(created);
      if (created.asset === "NIM") {
        void stakeAndFund(created, authHeader);
      }
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (state.phase === "created") {
    const c = state;
    const isRoom = c.mode !== "solo";
    const isPaid = c.step === "paid";
    return (
      <div className="mx-auto max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel
            label={isRoom ? "Room opened" : isPaid ? "Dare live" : "Dare staged"}
            icon={<Check className="size-3.5" />}
            badge={isPaid ? "LIVE / ON-CHAIN" : isRoom ? "LOBBY" : "PENDING / FUNDING"}
          >
            <div className="flex flex-col gap-6">
              {isPaid ? (
                <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
                  <Check className="mt-0.5 size-5 shrink-0 text-primary" />
                  <p className="text-sm leading-relaxed text-foreground">
                    {isRoom
                      ? `Your seat is locked. Your ${c.amount} ${c.asset} is on-chain in escrow. The room plays once every seat is funded or the deadline passes.`
                      : `Your ${c.amount} ${c.asset} stake is on-chain in escrow and the dare is live. Keep the evidence handy - you submit the proof before the deadline.`}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/5 px-5 py-4">
                    <Wallet className="mt-0.5 size-5 shrink-0 text-amber-300" />
                    <p className="text-sm leading-relaxed text-foreground">
                      {c.step === "funding"
                        ? `Confirm the ${c.amount} ${c.asset} payment in the Nimiq Pay sheet. The dare only goes live once the deposit is seen on-chain.`
                        : `Your dare is staged but not funded yet. Confirm ${c.amount} ${c.asset} in Nimiq Pay to lock the stake into escrow.`}
                    </p>
                  </div>
                  {c.error && (
                    <p className="font-mono text-[11px] text-red-400">ERR: {c.error}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => {
                        const retryMessage = `nimdares:fund:${Date.now()}:${c.dareId}`;
                        void wallet.signMessage(retryMessage).then((retrySig) => {
                          if (!retrySig) {
                            setState({ ...c, step: "failed", error: "wallet signature failed or was rejected" });
                            return;
                          }
                          const retryAuth = `Nimiq ${retrySig.publicKey}:${retrySig.signature}:${base64UrlEncode(retryMessage)}`;
                          void stakeAndFund(c, retryAuth);
                        });
                      }}
                      disabled={c.step === "funding" || !c.escrowAddress || !c.escrowConfigured}
                    >
                      <Wallet className="size-4" />
                      {c.step === "funding"
                        ? "Waiting for Pay…"
                        : `Confirm ${c.amount} ${c.asset} in Pay`}
                      <ArrowRight className="size-4" />
                    </Button>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      &gt; signed by your Nimiq identity; escrow: {c.escrowConfigured ? "hot" : "unconfigured"}
                    </p>
                  </div>
                  {c.escrowConfigured && c.escrowAddress && (
                    <div className="border-t border-border pt-4">
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-muted/20"
                        onClick={() => void navigator.clipboard?.writeText(c.escrowAddress!).catch(() => {})}
                      >
                        <Copy className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex flex-col gap-1">
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Escrow address (tap to copy · manual fallback)
                          </span>
                          <span className="break-all font-mono text-xs text-foreground/80">
                            {c.escrowAddress}
                          </span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              {isRoom && c.roomCode && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <p className="flex-1 font-mono text-3xl font-semibold tracking-[0.3em] text-primary">
                    {c.roomCode}
                  </p>
                  <Button href={`/app/dare/${c.dareId}`}>
                    Enter lobby <ArrowRight className="size-4" />
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button href={`/app/dare/${c.dareId}`}>
                  {isPaid ? "Open the dare" : "Open in lobby"} <ArrowRight className="size-4" />
                </Button>
                <Button href="/app">
                  <ArrowLeft className="size-4" /> Back to console
                </Button>
              </div>
            </div>
          </HudPanel>
        </motion.div>
      </div>
    );
  }

  const disabled = wallet.status !== "ready";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
          /operator-console/create-dare
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">New dare</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Define the commitment, stake on it, and choose how the verdict is reached.
        </p>
      </motion.div>

      {disabled && (
        <HudPanel label="Wallet" icon={<Wallet className="size-3.5" />}>
          <p className="font-mono text-sm text-muted-foreground">
            &gt; dares can only be created from inside Nimiq Pay. Development mode: {wallet.address ?? "no host, no address"}.
          </p>
        </HudPanel>
      )}

      {/* commitment */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <HudPanel label="01 · Commitment" icon={<Plus className="size-3.5" />}>
          <div className="flex flex-col gap-5">
            <Field label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Run a 10k in under 60 minutes"
                className="hud-input"
                maxLength={80}
              />
            </Field>
            <Field label="Details">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What exactly are you committing to, and why does it matter?"
                className="hud-input min-h-24 resize-y"
                maxLength={2000}
              />
            </Field>
            <Field label="Acceptance criteria">
              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="What evidence counts as completion? The verifier judges against this."
                className="hud-input min-h-24 resize-y"
                maxLength={2000}
              />
            </Field>
          </div>
        </HudPanel>
      </motion.div>

      {/* mode */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <HudPanel label="02 · Mode" icon={<Users className="size-3.5" />}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 md:flex-row">
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = mode === m.mode;
                return (
                  <button
                    key={m.mode}
                    onClick={() => setMode(m.mode)}
                    className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                      active ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <Icon className={`size-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="flex flex-col gap-0.5">
                      <span className={`text-sm capitalize ${active ? "text-foreground" : "text-muted-foreground"}`}>
                        {m.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{m.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {mode !== "solo" && (
              <Field label="Max players">
                <input
                  type="number"
                  min="2"
                  max="50"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="hud-input max-w-40"
                />
              </Field>
            )}
            <p className="font-mono text-[11px] text-muted-foreground">
              &gt; {mode === "solo" && "solo dares are private to you and fund straight from your wallet via Nimiq Pay"}
              {mode === "team" && "team rooms are private; each member joins with the invite code"}
              {mode === "arena" && "arena rooms are public and appear in the arena feed for anyone to join"}
            </p>
          </div>
        </HudPanel>
      </motion.div>

      {/* stake */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <HudPanel label="03 · Stake" icon={<Wallet className="size-3.5" />}>
          <div className="flex flex-col gap-5">
            <div className="flex gap-2">
              {(["NIM", "USDT"] as Asset[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAsset(a)}
                  className={`rounded-xl border px-4 py-2.5 font-mono text-sm transition-all ${
                    asset === a
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40"
                  }`}
                >
                  {a}
                </button>
              ))}
              {asset === "USDT" && (
                <span className="font-mono text-[10px] text-amber-300/80">manual funding only</span>
              )}
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label={`Amount (${asset})`}>
                <input
                  type="number"
                  min="0.01"
                  step={asset === "NIM" ? "0.01" : "0.1"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="hud-input"
                />
              </Field>
              <Field label="Deadline">
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="hud-input"
                />
              </Field>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              &gt; deadline must be within 90 days. Late or missing proof is slashed into the
              slash pool.
            </p>
          </div>
        </HudPanel>
      </motion.div>

      {/* verifier */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <HudPanel label="04 · Verifier" icon={<CircleAlert className="size-3.5" />}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 md:flex-row">
              {VERIFIERS.map((v) => {
                const Icon = v.icon;
                const active = verifier === v.kind;
                return (
                  <button
                    key={v.kind}
                    onClick={() => setVerifier(v.kind)}
                    className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                      active ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <Icon className={`size-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-sm ${active ? "text-foreground" : "text-muted-foreground"}`}>
                      {v.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {needsLink && (
              <Field label={verifier === "GITHUB" ? "GitHub username" : "Strava activity URL"}>
                <input
                  value={verifierLink}
                  onChange={(e) => setVerifierLink(e.target.value)}
                  placeholder={verifier === "GITHUB" ? "octocat" : "https://www.strava.com/activities/..."}
                  className="hud-input"
                />
              </Field>
            )}
            {verifier === "VISION" && (
              <p className="font-mono text-[11px] text-muted-foreground">
                &gt; you submit a screenshot as proof; the AI judge verifies it against the
                criteria after the deadline.
              </p>
            )}
          </div>
        </HudPanel>
      </motion.div>

      {state.phase === "error" && (
        <HudPanel label="Error" icon={<CircleAlert className="size-3.5" />}>
          <p className="font-mono text-sm text-red-400">ERR: {state.message}</p>
        </HudPanel>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <StatusPill label={disabled ? "NO WALLET" : "SIGN + PAY"} tone={disabled ? "neutral" : wallet.status === "signing" || state.phase === "signing" ? "live" : "neutral"} live={!disabled} />
          <p className="font-mono text-[11px] text-muted-foreground">
            {wallet.status === "signing" ? "host signing…" : "sign · stake · locked on-chain"}
          </p>
        </div>
        <Button onClick={handleCreate} disabled={disabled || state.phase === "signing" || state.phase === "submitting"}>
          {state.phase === "signing" || state.phase === "submitting" ? "Signing…" : `Stake ${amount} ${asset} & create`}
          <ArrowRight className="size-4" />
        </Button>
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
