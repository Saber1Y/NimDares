"server-only";

import type { DareRecord } from "@/lib/db";

export interface AdjudicationResult {
  /** AMBIGUOUS means the evidence is real but inconclusive: the stake is returned, never slashed. */
  status: "VALID" | "INVALID" | "AMBIGUOUS" | "UNAVAILABLE";
  reason: string;
  source?: string;
  /** Probability the goal was met, 0-100, when the verifier scores one. */
  confidence?: number;
  /** What the verifier observed, retained for disputes. */
  observations?: string;
}

// Dispatches adjudication by verifier kind. Each verifier reports an honest
// state: VALID / INVALID when evidence is decisive, or UNAVAILABLE when its
// required credentials or data are missing (never a fabricated verdict).
export async function adjudicateDare(dare: DareRecord): Promise<AdjudicationResult> {
  switch (dare.verifierKind) {
    case "VISION":
      return adjudicateVision(dare);
    case "GITHUB":
      return adjudicateGithub(dare);
    case "STRAVA":
      return adjudicateStrava(dare);
    default:
      return { status: "UNAVAILABLE", reason: `unknown verifier ${dare.verifierKind}` };
  }
}

async function adjudicateVision(dare: DareRecord): Promise<AdjudicationResult> {
  if (!dare.proofImageUrl) {
    return { status: "INVALID", reason: "no proof image was submitted" };
  }
  if (!process.env.GEMINI_API_KEY) {
    return {
      status: "UNAVAILABLE",
      reason: "GEMINI_API_KEY not configured; vision adjudication offline",
    };
  }
  // Vision pipeline implemented in src/lib/vision.ts
  const { runVisionAdjudication } = await import("@/lib/vision");
  return runVisionAdjudication(dare);
}

async function adjudicateGithub(dare: DareRecord): Promise<AdjudicationResult> {
  const username = dare.verifierLink?.trim();
  if (!username) {
    return { status: "INVALID", reason: "no GitHub username was provided" };
  }
  if (!process.env.GITHUB_TOKEN) {
    return {
      status: "UNAVAILABLE",
      reason: "GITHUB_TOKEN not configured; GitHub adjudication offline",
    };
  }
  const { runGithubAdjudication } = await import("@/lib/github");
  return runGithubAdjudication(dare, username);
}

async function adjudicateStrava(dare: DareRecord): Promise<AdjudicationResult> {
  const activityLink = (dare.proofLink ?? dare.verifierLink)?.trim();
  if (!activityLink) {
    return { status: "INVALID", reason: "no Strava activity link was provided" };
  }
  if (!process.env.STRAVA_ACCESS_TOKEN) {
    return {
      status: "UNAVAILABLE",
      reason: "STRAVA_ACCESS_TOKEN not configured; Strava adjudication offline",
    };
  }
  const { runStravaAdjudication } = await import("@/lib/strava");
  return runStravaAdjudication(dare, activityLink);
}