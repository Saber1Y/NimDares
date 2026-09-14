"server-only";

import { GoogleGenAI, Type, type Schema } from "@google/genai";

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

const SPEC_MODEL = process.env.GEMINI_SPEC_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

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
- Do not invent requirements the commitment never asked for, and do not make them stricter than the stated criteria.
- Write 3 to 5 requirements. Keep each under 140 characters.

Commitment title: {{TITLE}}
Details: {{DESCRIPTION}}
Acceptance criteria: {{CRITERIA}}
The dare window runs until {{DEADLINE}}.`;

export interface SpecInput {
  title: string;
  description: string;
  criteria: string;
  deadline: Date;
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
    .replace("{{DEADLINE}}", input.deadline.toISOString());

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: SPEC_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: SpecSchema,
        temperature: 0.2,
      },
    });
    const parsed = JSON.parse(res.text ?? "") as {
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
      source: SPEC_MODEL,
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
