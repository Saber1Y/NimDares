import { cn } from "@/lib/cn";

const tones = {
  live: "text-primary",
  neutral: "text-muted-foreground",
  failed: "text-red-400",
  success: "text-emerald-400",
} as const;

export function StatusPill({
  label,
  tone = "neutral",
  live = false,
}: {
  label: string;
  tone?: keyof typeof tones;
  live?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
        tones[tone]
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          live ? "nd-live-dot" : tone === "failed" ? "bg-red-500" : "bg-current opacity-70"
        )}
      />
      {label}
    </span>
  );
}