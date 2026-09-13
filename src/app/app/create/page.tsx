"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, GitBranch, Bike, Plus, Wallet, CircleAlert, Check, ImageIcon, Users, Globe, Hash } from "lucide-react";
import { useNimiqWallet } from "@/components/nimiq-provider";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { Asset, RoomMode, VerifierKind } from "@/lib/types";

type CreateState =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "submitting" }
  | {
      phase: "created";
      escrowAddress: string | null;
      escrowConfigured: boolean;
      asset: Asset;
      amount: number;
      mode: RoomMode;
      maxCapacity: number;
      roomCode: string | null;
      dareId: string;
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
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState({ phase: "error", message: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({
        phase: "created",
        escrowAddress: data.escrow?.address ?? null,
        escrowConfigured: data.escrow?.configured ?? false,
        asset,
        amount: Number(amount),
        mode,
        maxCapacity: data.dare?.maxCapacity ?? 1,
        roomCode: data.dare?.roomCode ?? null,
        dareId: data.dare?.id ?? "",
      });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (state.phase === "created") {
    const isRoom = state.mode !== "solo";
    return (
      <div className="mx-auto max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel label={isRoom ? "Room opened" : "Dare staged"} icon={<Check className="size-3.5" />} badge={isRoom ? "LOBBY" : "PENDING / FUNDING"}>
            <div className="flex flex-col gap-6">
              {isRoom ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
                    <CircleAlert className="mt-0.5 size-5 shrink-0 text-primary" />
                    <p className="text-sm leading-relaxed text-foreground">
                      Your {state.mode} room is open in the lobby. Every participant funds{" "}
                      <span className="font-mono text-primary">
                        {state.amount} {state.asset}
                      </span>{" "}
                      into escrow as they join, tagged by a per-seat memo so the ledger credits
                      the right chair. The room plays once every seat is funded or the deadline
                      passes.
                    </p>
                  </div>
                  {state.mode === "team" && state.roomCode && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                      <p className="flex-1 font-mono text-3xl font-semibold tracking-[0.3em] text-primary">
                        {state.roomCode}
                      </p>
                      <Button href={`/app/dare/${state.dareId}`}>
                        Enter lobby <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  )}
                  <p className="font-mono text-[11px] text-muted-foreground">
                    &gt; {state.mode === "team" ? `share the room code or the dashboard link with up to ${state.maxCapacity - 1} more people` : `public table · up to ${state.maxCapacity} players`}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
                    <CircleAlert className="size-5 text-primary" />
                    <p className="text-sm leading-relaxed text-foreground">
                      Stake is not yet on-chain. Send{" "}
                      <span className="font-mono text-primary">{state.amount} {state.asset}</span> to the escrow
                      address below. The dare is placed on the ledger the instant the sweep sees the
                      deposit.
                    </p>
                  </div>
                  <div className="border-t border-border pt-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Escrow address ({state.asset === "NIM" ? "Nimiq network" : "Polygon network"})
                    </p>
                    {state.escrowConfigured ? (
                      <p className="mt-3 break-all font-mono text-sm text-foreground">
                        {state.escrowAddress}
                      </p>
                    ) : (
                      <p className="mt-3 font-mono text-sm text-red-400">
                        UNAVAILABLE - escrow key not configured on this deployment
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {state.mode === "team" && (
                  <Button href={`/app/dare/${state.dareId}`}>
                    Open lobby <ArrowRight className="size-4" />
                  </Button>
                )}
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
              &gt; {mode === "solo" && "solo dares are private to you and fund from your own wallet"}
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
          <StatusPill label={disabled ? "NO WALLET" : "SIGN+POST"} tone={disabled ? "neutral" : wallet.status === "signing" || state.phase === "signing" ? "live" : "neutral"} live={!disabled} />
          <p className="font-mono text-[11px] text-muted-foreground">
            {wallet.status === "signing" ? "host signing…" : "signed by your Nimiq identity"}
          </p>
        </div>
        <Button onClick={handleCreate} disabled={disabled || state.phase === "signing" || state.phase === "submitting"}>
          {state.phase === "signing" || state.phase === "submitting" ? "Signing…" : "Sign & create"}
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