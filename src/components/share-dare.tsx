"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareDareProps {
  dareId: string;
  title: string;
  amount: number;
  asset: string;
  isRoom?: boolean;
  roomCode?: string | null;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}

/** Writes to the clipboard, falling back for older in-app browsers. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some WebViews expose no async clipboard; a hidden textarea still works.
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
}

function buildMessage(props: ShareDareProps): { text: string; url: string } {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const query = props.roomCode ? `?code=${encodeURIComponent(props.roomCode)}` : "";
  const url = `${base}/app/dare/${props.dareId}${query}`;
  const stake = `${props.amount} ${props.asset}`;
  // Both read as a dare. The room line also says how the pot is shared, since
  // everyone who proves it splits the forfeited stakes - not just one winner.
  const text = props.isRoom
    ? `I dare you: "${props.title}" — ${stake} a seat. Prove it and you split the pot.`
    : `I challenge you: "${props.title}" — ${stake} on the line.`;
  return { text, url };
}

/**
 * Shares a dare as a ready-to-send invite. Uses the phone's own share sheet
 * where there is one - that is what people expect on mobile - and copies the
 * message to the clipboard everywhere else.
 */
export function ShareDare({ variant = "secondary", className, ...dare }: ShareDareProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const { text, url } = buildMessage(dare as ShareDareProps);

    // The share sheet takes the link separately; joining them here too would
    // make it appear twice in the message people receive.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text, url });
        return;
      } catch (e) {
        // A cancelled sheet is not a failure; fall through to copying only
        // when the sheet itself is unavailable.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }

    const ok = await copyText(`${text}\n${url}`);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <div className={className}>
      <Button variant={variant} onClick={() => void share()}>
        {state === "copied" ? (
          <>
            <Check className="size-4" /> Copied — paste it to a friend
          </>
        ) : (
          <>
            <Share2 className="size-4" /> {dare.isRoom ? "Invite friends" : "Challenge a friend"}
          </>
        )}
      </Button>
      {state === "failed" && (
        <p className="mt-2 text-xs text-red-400">
          Couldn&apos;t copy automatically. Copy the link from your browser bar instead.
        </p>
      )}
    </div>
  );
}
