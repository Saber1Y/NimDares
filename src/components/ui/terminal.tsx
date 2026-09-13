import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const eventColors: Record<string, string> = {
  EVENT: "text-blue-400",
  SYS: "text-blue-400",
  OK: "text-emerald-400",
  AGENT: "text-purple-400",
  DIRECTOR: "text-amber-400",
  FAIL: "text-red-400",
};

export function TerminalRow({
  kind,
  children,
}: {
  kind: keyof typeof eventColors | string;
  children: ReactNode;
}) {
  const color = eventColors[kind.toUpperCase()] ?? "text-blue-400";
  return (
    <div className="text-foreground/80">
      <span className={`font-semibold ${color}`}>
        {kind.toUpperCase()}
      </span>{" "}
      {children}
    </div>
  );
}

export function TerminalBlock({
  title = "operator.log",
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-background shadow-2xl", className)}>
      <div className="flex items-center gap-2 border-b border-border/50 bg-card px-4 py-3">
        <span className="size-2.5 rounded-full bg-red-500/80" />
        <span className="size-2.5 rounded-full bg-yellow-500/80" />
        <span className="size-2.5 rounded-full bg-green-500/80" />
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">{title}</span>
      </div>
      <div className="flex flex-col gap-2 p-6 font-mono text-[13px] leading-relaxed md:p-8">
        {children}
      </div>
    </div>
  );
}
