import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(200,245,106,0.2)] hover:-translate-y-0.5 hover:shadow-[0_0_32px_rgba(200,245,106,0.4)]",
  secondary: "border border-border text-foreground hover:bg-muted/50",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-muted/40",
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ComponentProps<"a" | "button"> & { variant?: ButtonVariant }) {
  const base = cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-all active:translate-y-0 disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    className
  );
  if ("href" in props && props.href) {
    return <a className={base} {...(props as ComponentProps<"a">)} />;
  }
  return <button className={base} {...(props as ComponentProps<"button">)} />;
}