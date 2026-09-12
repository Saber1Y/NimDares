"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Copy,
  ImageIcon,
  GitBranch,
  Bike,
  CircleAlert,
  Check,
  ScanLine,
  Swords,
  Hourglass,
} from "lucide-react";
import { useNimiqWallet, isErrorResponse } from "@/components/nimiq-provider";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { Dare } from "@/lib/types";

type SubmitState =
  | { phase: "idle"; error: string | null }
  | { phase: "capturing" }
  | { phase: "signing" }
  | { phase: "submitting" }
  | { phase: "done"; message: string };

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  const when = d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (ms > 0) {
    const days = Math.floor(ms / 86_400_000);
    const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
    return ms > 86_400_000 ? `${when} · ${days}d ${hrs}h left` : `${when} · ${hrs}h left`;
  }
  return `${when} · expired`;
}

function base64UrlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function DareDetail({ id, initial }: { id: string; initial: Dare | null }) {
  const wallet = useNimiqWallet();
  const [dare, setDare] = useState<Dare | null>(initial);
  const [missing, setMissing] = useState(false);
  const [proofLink, setProofLink] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle", error: null });
  const [copied, setCopied] = useState(false);
  const [funding, setFunding] = useState<{ phase: "idle" } | { phase: "sending"; serialized: string | null }>(
    { phase: "idle" }
  );
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dare) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dares/${id}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.dare) setDare(data.dare);
      } catch {
        /* keep last known state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, dare]);

  useEffect(() => {
    if (!dare) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/dares/${dare.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.dare) {
          const next = data.dare as Dare;
          setDare((prev) =>
            prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next
          );
        }
      } catch {
        /* keep last known state */
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [dare]);

  if (missing) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-24 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/30">
          <Hourglass className="size-6 text-muted-foreground" />
        </div>
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-foreground">
            DARE NOT FOUND
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            The ledger has no record for this dare id. It may live on a different
            store than this deployment.
          </p>
        </div>
        <Button href="/app">Back to console</Button>
      </div>
    );
  }

  if (!dare) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-24 text-center">
        <p className="font-mono text-sm text-muted-foreground">&gt; reading ledger…</p>
      </div>
    );
  }

  const cur = dare;

  const tone =
    cur.status === "WON"
      ? "success"
      : cur.status === "LOST"
        ? "failed"
        : cur.status === "ACTIVE" || cur.status === "PENDING_FUNDING"
          ? "live"
          : "neutral";

  const VerifierIcon = cur.verifierKind === "STRAVA" ? Bike : cur.verifierKind === "GITHUB" ? GitBranch : ImageIcon;

  async function fundFromWallet() {
    const recip = cur.escrow?.address;
    if (!recip) {
      setFunding({ phase: "idle" });
      return;
    }
    if (!wallet.provider || wallet.status !== "ready") {
      setFunding({ phase: "idle" });
      return;
    }
    setFunding({ phase: "sending", serialized: null });
    try {
      const valueLuna = Math.round(cur.amount * 100_000);
      const feeLuna = Math.round(valueLuna / 1000) + 100;
      const height = await wallet.provider.getBlockNumber();
      const result = await wallet.provider.sendBasicTransaction({
        recipient: recip,
        value: valueLuna,
        fee: feeLuna,
        validityStartHeight: height,
      });
      if (isErrorResponse(result)) {
        setFunding({ phase: "idle" });
        setSubmit({ phase: "idle", error: `funding rejected: ${result.error.message}` });
        return;
      }
      setFunding({ phase: "sending", serialized: typeof result === "string" ? result : null });
    } catch (e) {
      setFunding({ phase: "idle" });
      setSubmit({ phase: "idle", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function submitProof(image?: string) {
    if (!wallet.address || wallet.status !== "ready") {
      setSubmit({ phase: "idle", error: "wallet not connected; cannot sign the proof" });
      return;
    }
    const isVision = cur.verifierKind === "VISION";
    if (isVision && !image) {
      setSubmit({ phase: "idle", error: "capture a screenshot first" });
      return;
    }
    if (!isVision && !proofLink.trim()) {
      setSubmit({ phase: "idle", error: "provide the verifier link first" });
      return;
    }

    const dareId = cur.id;
    const message = `nimdares:proof:${dareId}:${Date.now()}`;
    setSubmit({ phase: "signing" });
    const sig = await wallet.signMessage(message);
    if (!sig) {
      setSubmit({ phase: "idle", error: "wallet signature failed or was rejected" });
      return;
    }

    setSubmit({ phase: "submitting" });
    const authHeader = `Nimiq ${sig.publicKey}:${sig.signature}:${base64UrlEncode(message)}`;
    try {
      const body = isVision && image ? { proofImage: image } : { proofLink: proofLink.trim() };
      const res = await fetch(`/api/dares/${dareId}/proof`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSubmit({ phase: "idle", error: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      setSubmit({ phase: "done", message: data.message ?? "proof submitted" });
      if (data.dare) setDare(data.dare);
    } catch (e) {
      setSubmit({ phase: "idle", error: e instanceof Error ? e.message : String(e) });
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmit({ phase: "capturing" });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (dataUrl.length > 6_000_000) {
        setSubmit({ phase: "idle", error: "image too large; keep it under ~4.5 MB" });
        return;
      }
      setSubmit({ phase: "idle", error: null });
      void submitProof(dataUrl);
    };
    reader.onerror = () => setSubmit({ phase: "idle", error: "could not read image" });
    reader.readAsDataURL(file);
  }

  const escrowShown =
    cur.status === "PENDING_FUNDING" &&
    (cur.ownerAddress === wallet.address || wallet.status !== "ready");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Button href="/app" variant="ghost" className="px-0 text-muted-foreground">
          <ArrowLeft className="size-4" /> Console
        </Button>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
            /operator-console/dare/{cur.id.slice(0, 8)}
          </p>
          <StatusPill label={cur.status} tone={tone} live={tone === "live"} />
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
          {cur.title}
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">{cur.description}</p>
      </motion.div>

      {/* status strip */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="Status" icon={<Swords className="size-3.5" />}>
          <div className="grid gap-6 md:grid-cols-4">
            <Stat label="Stake" value={`${formatAmount(cur.amount)} ${cur.asset}`} mono />
            <Stat label="Deadline" value={formatDeadline(cur.deadline)} mono />
            <Stat label="Verifier" value={cur.verifierKind} mono />
            <Stat label="Owner" value={`${cur.ownerAddress.slice(0, 6)}…${cur.ownerAddress.slice(-4)}`} mono />
          </div>
        </HudPanel>
      </motion.div>

      {/* escrow deposit guidance */}
      {escrowShown && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel label="Funding" icon={<CircleAlert className="size-3.5" />} badge="PENDING">
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Send <span className="font-mono text-primary">{formatAmount(cur.amount)} {cur.asset}</span> to
                the escrow address. The sweep places the dare once the deposit is observed
                on-chain.
              </p>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                <p className="flex-1 break-all font-mono text-sm text-foreground">
                  {cur.escrow?.address ?? "ESCROW NOT CONFIGURED"}
                </p>
                {cur.escrow?.address && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(cur.escrow?.address ?? "").catch(() => {});
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    <Copy className="size-4" />
                  </button>
                )}
              </div>
              {copied && <StatusPill label="COPIED" tone="live" live />}
              {cur.asset === "NIM" && wallet.provider && wallet.status === "ready" && (
                <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
                  <Button onClick={() => void fundFromWallet()} disabled={funding.phase === "sending"}>
                    {funding.phase === "sending" ? "Sending…" : `Fund ${formatAmount(cur.amount)} NIM from wallet`}
                  </Button>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    &gt; signed by the Pay host; the sweep auto-activates once the deposit lands
                  </p>
                </div>
              )}
              {funding.phase === "sending" && funding.serialized && (
                <p className="font-mono text-[11px] text-primary">
                  TX SENT TO PAY HOST - {funding.serialized.slice(0, 40)}…
                </p>
              )}
            </div>
          </HudPanel>
        </motion.div>
      )}

      {/* criteria */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="Acceptance criteria" icon={<ScanLine className="size-3.5" />}>
          <p className="text-sm leading-relaxed text-foreground">{cur.criteria}</p>
          {cur.verifierLink && (
            <p className="mt-4 font-mono text-[11px] text-muted-foreground">
              verifier input: <span className="text-primary">{cur.verifierLink}</span>
            </p>
          )}
        </HudPanel>
      </motion.div>

      {/* verdict */}
      {cur.verifierResult && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel
            label="Verdict"
            icon={<Check className="size-3.5" />}
            badge={cur.verifierResult.status}
          >
            <p className="font-mono text-sm leading-relaxed text-foreground">
              {cur.verifierResult.reason}
            </p>
            {cur.payoutStatus && (
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                payout: <span className="text-primary">{cur.payoutStatus}</span>
                {cur.payoutTxHash && ` · ${cur.payoutTxHash.slice(0, 18)}…`}
              </p>
            )}
          </HudPanel>
        </motion.div>
      )}

      {/* proof submission */}
      {(cur.status === "ACTIVE" || cur.status === "PENDING_FUNDING") && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel label="Submit proof" icon={<VerifierIcon className="size-3.5" />}>
            <div className="flex flex-col gap-5">
              {cur.verifierKind === "VISION" ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Attach the evidence screenshot. The AI judge checks it against the
                    acceptance criteria once the deadline passes.
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFile}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => fileRef.current?.click()}
                      disabled={wallet.status !== "ready" || submit.phase === "signing" || submit.phase === "submitting" || submit.phase === "capturing"}
                    >
                      {submit.phase === "capturing" ? "Reading…" : "Attach screenshot"}
                      <ImageIcon className="size-4" />
                    </Button>
                    {cur.proofImageUrl && (
                      <StatusPill label="PROOF ON LEDGER" tone="neutral" />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Link your {cur.verifierKind === "GITHUB" ? "GitHub commit activity" : "Strava activity"} as proof.
                  </p>
                  <input
                    value={proofLink}
                    onChange={(e) => setProofLink(e.target.value)}
                    placeholder={cur.verifierKind === "GITHUB" ? "https://github.com/user" : "https://www.strava.com/activities/…"}
                    className="hud-input"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void submitProof()}
                      disabled={wallet.status !== "ready" || submit.phase === "signing" || submit.phase === "submitting" || !proofLink.trim()}
                    >
                      {submit.phase === "signing" ? "Signing…" : submit.phase === "submitting" ? "Submitting…" : "Submit proof"}
                    </Button>
                  </div>
                </div>
              )}
              {submit.phase === "idle" && submit.error && (
                <p className="font-mono text-[11px] text-red-400">ERR: {submit.error}</p>
              )}
              {submit.phase === "done" && (
                <p className="font-mono text-[11px] text-primary">OK: {submit.message}</p>
              )}
            </div>
          </HudPanel>
        </motion.div>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-t border-border pt-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-3 text-sm ${mono ? "font-mono" : ""} text-foreground`}>{value}</p>
    </div>
  );
}