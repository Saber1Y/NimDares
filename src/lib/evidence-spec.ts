"server-only";

import { GoogleGenAI, Type, type Schema } from "@google/genai";
import {
  callWithModelFallback,
  modelChain,
  modelChainFailureReason,
} from "@/lib/gemini-chain";
import { formatInZone, zoneOrUtc } from "@/lib/time";

/**
 * A dare's evidence requirements, fixed at creation time and shown to the user
 * before they stake. The judge checks a screenshot against this list instead of
 * re-deciding what a "running dare" or "PR dare" ought to look like, so two
 * identical dares are judged identically and nobody is ruled against on
 * criteria they never saw.
 */
export interface EvidenceSpec {
  /** 3-5 short, checkable requirements. */
  requirements: string[];
  /** What the screenshot is expected to be of, e.g. "a merged GitHub pull request page". */
  expectedArtifact: string;
  source: string;
  generatedAt: string;
}

const SPEC_MODELS = modelChain();

const SpecSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    expectedArtifact: {
      type: Type.STRING,
      description:
        "One phrase naming the screen the proof should be of, e.g. 'a merged GitHub pull request page' or 'a completed run in a fitness tracker'.",
    },
    requirements: {
      type: Type.ARRAY,
      description:
        "3-5 requirements, each independently checkable by looking at one screenshot.",
      items: { type: Type.STRING },
    },
  },
  required: ["expectedArtifact", "requirements"],
};

const SPEC_PROMPT = `You turn a staked commitment into a proof checklist for an automated image judge.

The user will submit ONE screenshot as proof. Write the requirements that screenshot must satisfy.

Rules:
- Each requirement must be checkable by looking at a single screenshot. No requirement may depend on outside knowledge, on browsing, or on data the image cannot show.
- Be concrete about what must be visible: the app or site, the state ("Merged", "Completed"), identifying details (username, repository, distance, duration), and any date that has to fall inside the dare window.
- Dates and times in the screenshot are on the user's own clock, in {{ZONE}}. Write any date requirement in that local time, and phrase it by calendar day rather than by the hour, since a screenshot often shows only a date.
- The dare can be completed at ANY point in the window, not only on its last day. A date requirement must accept every day from {{OPENED}} to {{DEADLINE}} inclusive - write it as a range, never as one specific day, and never call the deadline "today". Pin it to a single day only if the commitment itself names that day.
- Do not invent requirements the commitment never asked for, and do not make them stricter than the stated criteria.
- Write 3 to 5 requirements. Keep each under 140 characters.

Commitment title: {{TITLE}}
Details: {{DESCRIPTION}}
Acceptance criteria: {{CRITERIA}}
The dare window opens {{OPENED}} and closes {{DEADLINE}}.`;

export interface SpecInput {
  title: string;
  description: string;
  criteria: string;
  deadline: Date;
  /** When the window opens. Defaults to now, which is when a dare is created. */
  createdAt?: Date;
  /** Zone the dare was created in; requirements are written against it. */
  timezone?: string | null;
}

/**
 * Generates the checklist. Returns null when the model is unavailable — the
 * judge then falls back to the raw criteria, so dare creation never blocks on it.
 */
export async function generateEvidenceSpec(input: SpecInput): Promise<EvidenceSpec | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = SPEC_PROMPT.replace("{{TITLE}}", input.title)
    .replace("{{DESCRIPTION}}", input.description)
    .replace("{{CRITERIA}}", input.criteria)
    .replaceAll("{{ZONE}}", zoneOrUtc(input.timezone))
    .replaceAll("{{OPENED}}", formatInZone(input.createdAt ?? new Date(), input.timezone))
    // Local wall clock, not an ISO instant: the requirement it writes is read
    // back against a screenshot showing the user's own clock.
    .replaceAll("{{DEADLINE}}", formatInZone(input.deadline, input.timezone));

  try {
    const ai = new GoogleGenAI({ apiKey });
    const { result, model } = await callWithModelFallback(
      async (model) =>
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: SpecSchema,
            temperature: 0.2,
          },
        }),
      SPEC_MODELS,
    );
    const parsed = JSON.parse(result.text ?? "") as {
      expectedArtifact?: unknown;
      requirements?: unknown;
    };
    const requirements = Array.isArray(parsed.requirements)
      ? parsed.requirements.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      : [];
    if (requirements.length === 0) return null;
    return {
      requirements: requirements.slice(0, 5),
      expectedArtifact:
        typeof parsed.expectedArtifact === "string" ? parsed.expectedArtifact : "a screenshot",
      source: model,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function isEvidenceSpec(v: unknown): v is EvidenceSpec {
  if (typeof v !== "object" || v === null) return false;
  const spec = v as Partial<EvidenceSpec>;
  return (
    Array.isArray(spec.requirements) &&
    spec.requirements.length > 0 &&
    spec.requirements.every((r) => typeof r === "string") &&
    // Interpolated into the judge prompt and the UI, so it must be a string
    // rather than rendering as "undefined".
    typeof spec.expectedArtifact === "string" &&
    spec.expectedArtifact.length > 0
  );
}
