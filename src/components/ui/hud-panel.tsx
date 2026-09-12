import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function HudPanel({
  label,
  icon,
  badge,
  className,
  children,
}: {
  label: string;
  icon?: ReactNode;
  badge?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card/65 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl md:p-7",
        className
      )}
    >
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {icon && <span className="text-primary">{icon}</span>}
          {label}
        </div>
        {badge && (
          <span className="font-mono text-[9px] text-primary">{badge}</span>
        )}
      </div>
      {children}
    </section>
  );
}