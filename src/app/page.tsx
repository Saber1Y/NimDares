"use client";

import { motion } from "motion/react";
import {
  ArrowRight,
  Activity,
  ScanLine,
  GitPullRequest,
  Wallet,
  ShieldCheck,
  Swords,
  CircleAlert,
} from "lucide-react";
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
    <main className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <DotGrid />

      <div className="relative z-10">
        <PillNav />

        {/* HERO */}
        <section className="mx-auto w-full max-w-[1400px] px-5 pb-24 pt-28 md:px-10 md:pb-32 md:pt-44">
          <div className="mx-auto grid max-w-[1160px] gap-16 md:grid-cols-[1.15fr_0.85fr] md:items-center">
            <div>
              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.15,
                  duration: 0.6,
                  ease: [0.16, 1, 0.3, 1],
                }}
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
                transition={{
                  delay: 0.3,
                  duration: 0.6,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground"
              >
                NimDares puts your own money behind your promises, inside Nimiq
                Pay. Stake NIM on any personal goal, send a screenshot when you
                finish, and you get your stake straight back. Fall short and you
                lose it.
              </motion.p>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.45,
                  duration: 0.6,
                  ease: [0.16, 1, 0.3, 1],
                }}
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
              transition={{
                delay: 0.35,
                duration: 0.6,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <div className="flex items-center justify-between px-1 pb-3">
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Activity className="size-3.5 text-primary" /> How a dare
                  plays out
                </span>
              </div>
              <TerminalBlock title="ship v0 by friday">
                {[
                  {
                    kind: "SYS" as const,
                    text: "You stake 10 NIM on \u201cShip v0 by Friday\u201d.",
                  },
                  {
                    kind: "EVENT" as const,
                    text: "Friday. You send one screenshot as your proof.",
                  },
                  {
                    kind: "AGENT" as const,
                    text: "The judge checks it against the rules you agreed to.",
                  },
                  {
                    kind: "OK" as const,
                    text: "Verified. Your 10 NIM goes straight back to your wallet.",
                  },
                ].map((row, i) => (
                  <motion.div
                    key={row.text}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: 0.7 + i * 0.45,
                      duration: 0.4,
                      ease: [0.16, 1, 0.3, 1],
                    }}
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
          <motion.div
            {...fade}
            className="mx-auto grid max-w-[1160px] grid-cols-2 gap-8 md:grid-cols-4"
          >
            {[
              { label: "Stake in", value: "NIM" },
              { label: "Proof", value: "A screenshot" },
              { label: "Judged", value: "24/7" },
              { label: "Middlemen", value: "0" },
            ].map((m) => (
              <div key={m.label} className="border-t border-border pt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {m.label}
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-primary">
                  {m.value}
                </p>
              </div>
            ))}
          </motion.div>
        </section>

        {/* HOW IT WORKS */}
        <section
          id="how"
          className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-32"
        >
          <div className="mx-auto max-w-[1160px]">
            <motion.div {...fade}>
              <h2 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
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
                  body: "Send one screenshot of the thing you said you would do. An AI judge checks it against the rules you set when you started.",
                },
                {
                  icon: <Swords className="size-4" />,
                  label: "03 · SETTLE",
                  title: "Money moves",
                  body: "Did it: your stake comes straight back. Did not: you forfeit it, and in a group dare the people who followed through share it.",
                },
              ].map((step, i) => (
                <motion.div
                  key={step.label}
                  {...fade}
                  transition={{
                    delay: i * 0.06,
                    duration: 0.5,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <HudPanel label={step.label} icon={step.icon}>
                    <h3 className="text-xl font-semibold tracking-[-0.03em]">
                      {step.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                  </HudPanel>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* PROOF */}
        <section
          id="proof"
          className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-32"
        >
          <div className="mx-auto grid max-w-[1160px] gap-14 md:grid-cols-2 md:items-start">
            <motion.div {...fade}>
              <h2 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
                Screenshot-proof gaming is dead.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                The judge compares your screenshot against the exact rules you
                agreed to when you staked, and answers one question: did you
                actually do the thing?
              </p>
              <div className="mt-8 flex flex-col gap-3">
                <StatusPill label="Rules agreed up front" tone="live" live />
                <StatusPill label="Same rules for everyone" tone="neutral" />
                <StatusPill label="Unclear proof is refunded" tone="neutral" />
              </div>
            </motion.div>
            <motion.div
              {...fade}
              transition={{
                delay: 0.1,
                duration: 0.5,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <HudPanel
                label="A ruling, in plain words"
                icon={<CircleAlert className="size-3.5" />}
              >
                <div className="space-y-4">
                  <TerminalRow kind="EVENT">Screenshot received.</TerminalRow>
                  <TerminalRow kind="AGENT">
                    Checked: the right goal, inside your dates, not edited.
                  </TerminalRow>
                  <TerminalRow kind="OK">
                    Verified — your stake comes back.
                  </TerminalRow>
                  <TerminalRow kind="FAIL">
                    Not verified — the screenshot was from before you started.
                  </TerminalRow>
                </div>
              </HudPanel>
            </motion.div>
          </div>
        </section>

        {/* VERIFIERS */}
        <section
          id="verifiers"
          className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-32"
        >
          <motion.div {...fade} className="mx-auto max-w-[1160px]">
            <HudPanel
              label="What the judge checks"
              icon={<GitPullRequest className="size-4" />}
              badge="EVERY DARE"
            >
              <div className="grid gap-8 md:grid-cols-3">
                {[
                  {
                    name: "The right thing",
                    detail:
                      "Your screenshot has to show the goal you staked on, not something close to it.",
                  },
                  {
                    name: "The right time",
                    detail:
                      "Dates in the screenshot have to fall inside the window you set when you created the dare.",
                  },
                  {
                    name: "The real thing",
                    detail:
                      "Edited or staged screenshots are rejected, and the same screenshot cannot be used twice.",
                  },
                ].map((v) => (
                  <div key={v.name} className="border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
                        {v.name}
                      </p>
                      <ShieldCheck className="size-4 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {v.detail}
                    </p>
                  </div>
                ))}
              </div>
            </HudPanel>
          </motion.div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-[1400px] border-t border-border px-5 py-24 md:px-10 md:py-36">
          <motion.div
            {...fade}
            className="mx-auto max-w-[1160px] rounded-2xl border border-border bg-card/65 p-10 text-center shadow-2xl shadow-black/20 backdrop-blur-xl md:p-16"
          >
            <h2 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl">
              What are you putting
              <br />
              on the line tonight?
            </h2>
            <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Open NimDares inside Nimiq Pay and stake your first dare in under
              a minute.
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
