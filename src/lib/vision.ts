"server-only";

import { GoogleGenAI } from "@google/genai";
import type { DareRecord } from "@/lib/db";

export interface VisionVerdict {
  status: "VALID" | "INVALID" | "UNAVAILABLE";
  reason: string;
  source: string;
}

const VISION_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

const JUDGE_PROMPT = `You are an impartial proof adjudicator on a goal-commitment platform.
A user staked funds on the following commitment and submitted a screenshot as proof of completion.
Decide whether the image is genuine, relevant, and convincingly demonstrates the commitment.
Rules:
- Reject obvious fakes: screenshots with altered numbers, mismatched timestamps or apps,
  images unrelated to the commitment, or doctored-looking content.
- Be fair: the proof does not need to be perfect, only believable and on-topic.
Respond with STRICT JSON only, no markdown, no commentary:
{"status": "VALID" | "INVALID", "reason": "specific, honest, concise explanation"}.

Commitment title: TITLE
Details: DESCRIPTION
Acceptance criteria: CRITERIA`;

export async function runVisionAdjudication(dare: DareRecord): Promise<VisionVerdict> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { status: "UNAVAILABLE", reason: "GEMINI_API_KEY not configured", source: "gemini" };
  }
  if (!dare.proofImageUrl) {
    return { status: "INVALID", reason: "no proof image was submitted", source: "gemini" };
  }

  const [mimeHeader, b64] = dare.proofImageUrl.split(",");
  const mimeType = mimeHeader.match(/data:(image\/\w+);base64/)?.[1] ?? "image/png";

  const prompt = JUDGE_PROMPT.replace("TITLE", dare.title)
    .replace("DESCRIPTION", dare.description)
    .replace("CRITERIA", dare.criteria);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: b64 } },
          ],
        },
      ],
    });
    const text = res.text ?? "";
    const json = extractJson(text);
    if (!json) {
      return {
        status: "UNAVAILABLE",
        reason: "vision model returned no parseable verdict",
        source: "gemini",
      };
    }
    const status = json.status === "VALID" ? "VALID" : "INVALID";
    return {
      status,
      reason: typeof json.reason === "string" ? json.reason : "no reason given",
      source: VISION_MODEL,
    };
  } catch (e) {
    return {
      status: "UNAVAILABLE",
      reason: e instanceof Error ? e.message : String(e),
      source: "gemini",
    };
  }
}

function extractJson(text: string): { status?: string; reason?: string } | null {
  try {
    const cleaned = text
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as { status?: string; reason?: string };
  } catch {
    return null;
  }
}