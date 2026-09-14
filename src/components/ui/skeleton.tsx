import { cn } from "@/lib/cn";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("nd-skeleton", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
