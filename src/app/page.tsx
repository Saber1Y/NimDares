"use client";

import { motion } from "motion/react";
import { ArrowRight, Activity, ScanLine, GitPullRequest, Wallet, ShieldCheck, Swords, CircleAlert } from "lucide-react";
import { DotGrid } from "@/components/ui/dot-grid";
import { PillNav } from "@/components/pill-nav";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { TerminalBlock, TerminalRow } from "@/components/ui/terminal";
import { Button } from "@/components/ui/button";

const fade = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
};

export default function Landing() {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#09090b] text-foreground">
      <DotGrid />

      <div className="relative z-10">
        <PillNav />

        {/* HERO */}
        <section className="mx-auto w-full max-w-[1400px] px-5 pb-24 pt-28 md:px-10 md:pb-32 md:pt-44">
          <div className="mx-auto grid max-w-[1160px] gap-16 md:grid-cols-[1.15fr_0.85fr] md:items-center">
            <div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary"
              >
                Commitment money · Nimiq Pay mini app
              </motion.p>
              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mt-5 text-5xl font-semibold leading-[0.98] tracking-[-0.065em] md:text-7xl"
              >
                A dare you keep,
                <br />
                because{" "}
                <span className="relative inline-block">
                  <span className="absolute inset-x-0 bottom-1 top-1 -z-10 -rotate-2 bg-primary text-background" />
                  NIM&nbsp;
                </span>
                is on it.
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground"
              >
                NimDares is a decentralized commitment escrow inside Nimiq Pay.
                Lock NIM or USDT on any personal goal, submit AI-verified proof
                when you finish, and the escrow pays you out automatically.
                Slack, and it sweeps to the slash pool.
              </motion.p>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mt-10 flex flex-wrap items-center gap-4"
              >
                <Button href="/app" className="text-base">
                  Launch app <ArrowRight className="size-4" />
                </Button>
                <Button href="#how" variant="secondary">
                  How it works
                </Button>
              </motion.div>
            </div>

            {/* LIVE TERMINAL */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.35, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center justify-between px-1 pb-3">
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Activity className="size-3.5 text-primary" /> Escrow lifecycle
                </span>
                <StatusPill label="REAL / LIVE" tone="live" live />
              </div>
              <TerminalBlock title="escrow_engine.log">
                {[
                  { kind: "SYS" as const, text: "ESCROW_OPEN 10 NIM staked on \u201cShip v0 by Friday\u201d." },
                  { kind: "EVENT" as const, text: "PROOF_INTAKE screenshot 2026-09-12_14:02 \u2192 gemini-3.6-flash" },
                  { kind: "AGENT" as const, text: "ADJUDICATE matches criteria: streak counter, build output, date." },
                  { kind: "OK" as const, text: "VALID \u2192 payout scheduled. 10.00 NIM \u2192 user wallet." },
                  { kind: "EVENT" as const, text: "SETTLE escrow signed & broadcast. Hash 0x9f3a\u2026e21" },
                ].map((row, i) => (
                  <motion.div
                    key={row.text}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 + i * 0.45, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <TerminalRow kind={row.kind}>{row.text}</TerminalRow>
                  </motion.div>
                ))}
              </TerminalBlock>
            </motion.div>
          </div>
        </section>

        {/* METRICS */}
        <section className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-16 md:px-10">
          <motion.div {...fade} className="mx-auto grid max-w-[1160px] grid-cols-2 gap-8 md:grid-cols-4">
            {[
              { label: "Assets escrowed", value: "NIM · USDT" },
              { label: "Verifier modes", value: "3" },
              { label: "Adjudicator uptime", value: "24/7" },
              { label: "Middlemen", value: "0" },
            ].map((m) => (
              <div key={m.label} className="border-t border-border pt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{m.label}</p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-primary">{m.value}</p>
              </div>
            ))}
          </motion.div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-32">
          <div className="mx-auto max-w-[1160px]">
            <motion.div {...fade}>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">/how-it-works</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
                Three moves. No referee.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                The protocol replaces willpower with an immutable stake and a
                verifiable outcome. Everything is forced, nothing is negotiated.
              </p>
            </motion.div>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                {
                  icon: <Wallet className="size-4" />,
                  label: "01 · DARE",
                  title: "Price the failure",
                  body: "Define the goal, the deadline, and the cost of quitting. Stake NIM or USDT straight from your Nimiq Pay wallet, in-app.",
                },
                {
                  icon: <ScanLine className="size-4" />,
                  label: "02 · PROVE",
                  title: "Evidence, judged",
                  body: "Screenshot proof, a merged GitHub PR, a logged Strava ride. Gemini vision or a deterministic API checks it against your criteria.",
                },
                {
                  icon: <Swords className="size-4" />,
                  label: "03 · SETTLE",
                  title: "Escrow decides",
                  body: "You won: escrow pays your stake back on-chain. You slacked: it is swept to the slash pool, funding the next generation of dares.",
                },
              ].map((step, i) => (
                <motion.div
                  key={step.label}
                  {...fade}
                  transition={{ delay: i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <HudPanel label={step.label} icon={step.icon}>
                    <h3 className="text-xl font-semibold tracking-[-0.03em]">{step.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </HudPanel>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* PROOF */}
        <section id="proof" className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-32">
          <div className="mx-auto grid max-w-[1160px] gap-14 md:grid-cols-2 md:items-start">
            <motion.div {...fade}>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">/proof</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
                Screenshot-proof gaming is dead.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                Verifiers compare the evidence against your exact stated criteria
                and answer one question: did you actually do the thing? Vision
                understands images; API verifiers read ground truth.
              </p>
              <div className="mt-8 flex flex-col gap-3">
                <StatusPill label="VISION · Gemini 2.5 Flash / Pro" tone="live" live />
                <StatusPill label="GITHUB · merged PR check" tone="neutral" />
                <StatusPill label="STRAVA · logged activity check" tone="neutral" />
              </div>
            </motion.div>
            <motion.div {...fade} transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
              <HudPanel label="Adjudicator verdict" icon={<CircleAlert className="size-3.5" />} badge="REAL / LIVE">
                <div className="space-y-4">
                  <TerminalRow kind="EVENT">VERIFIER vision: image fingerprint 0x58d1…c2f0</TerminalRow>
                  <TerminalRow kind="AGENT">CRITERIA kinopoisk rating ≥ 8.0 shown; streak days ≥ 7 shown.</TerminalRow>
                  <TerminalRow kind="OK">VALID — signed verdict 0x33aa…9b11</TerminalRow>
                  <TerminalRow kind="FAIL">INVALID — reverse-stitched screenshot, duplicate streak row.</TerminalRow>
                </div>
              </HudPanel>
            </motion.div>
          </div>
        </section>

        {/* VERIFIERS */}
        <section id="verifiers" className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-32">
          <motion.div {...fade} className="mx-auto max-w-[1160px]">
            <HudPanel label="Verifier matrix" icon={<GitPullRequest className="size-4" />} badge="DETERMINISTIC + AI">
              <div className="grid gap-8 md:grid-cols-3">
                {[
                  {
                    name: "VISION",
                    detail: "Gemini 2.5 reads screenshots against literal criteria. Ruling is signed and stored on the dare.",
                  },
                  {
                    name: "GITHUB",
                    detail: "A merged PR by your account inside the deadline is the evidence. No screenshot, no dispute.",
                  },
                  {
                    name: "STRAVA",
                    detail: "Your logged activity with the right type on the right day settles the dare on the spot.",
                  },
                ].map((v) => (
                  <div key={v.name} className="border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{v.name}</p>
                      <ShieldCheck className="size-4 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{v.detail}</p>
                  </div>
                ))}
              </div>
            </HudPanel>
          </motion.div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-36">
          <motion.div {...fade} className="mx-auto max-w-[1160px] rounded-2xl border border-border bg-card/65 p-10 text-center shadow-2xl shadow-black/20 backdrop-blur-xl md:p-16">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">/deploy</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] md:text-6xl">
              What are you putting
              <br />
              on the line tonight?
            </h2>
            <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Open NimDares inside Nimiq Pay and stake your first dare in under a minute.
            </p>
            <div className="mt-10 flex justify-center">
              <Button href="/app" className="px-8 text-base">
                Launch app <ArrowRight className="size-4" />
              </Button>
            </div>
          </motion.div>
        </section>

        <footer className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-8 md:px-10">
          <div className="mx-auto flex max-w-[1160px] flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              NimDares © 2026
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              MIT · Nimiq Pay Mini Apps Competition · Cycle 3 · Sep 2026
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}