"server-only";

import type { DareRecord } from "@/lib/db";

export interface GithubVerdict {
  status: "VALID" | "INVALID" | "UNAVAILABLE";
  reason: string;
  source: string;
}

interface GithubEvent {
  type?: string;
  created_at?: string;
  repo?: { name?: string };
  public?: boolean;
}

export async function runGithubAdjudication(
  dare: DareRecord,
  username: string
): Promise<GithubVerdict> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { status: "UNAVAILABLE", reason: "GITHUB_TOKEN not configured", source: "github" };
  }
  const cleanUser = username.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9-]{1,39}$/.test(cleanUser)) {
    return { status: "INVALID", reason: "malformed GitHub username", source: "github" };
  }

  try {
    const res = await fetch(`https://api.github.com/users/${cleanUser}/events/public`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return { status: "INVALID", reason: `GitHub user @${cleanUser} not found`, source: "github" };
    }
    if (res.status === 403 || res.status === 401) {
      return {
        status: "UNAVAILABLE",
        reason: `GitHub API ${res.status}: ${res.statusText}`,
        source: "github",
      };
    }
    if (!res.ok) {
      return {
        status: "UNAVAILABLE",
        reason: `GitHub API ${res.status}: ${res.statusText}`,
        source: "github",
      };
    }
    const events = (await res.json()) as GithubEvent[];
    const since = new Date(dare.createdAt).getTime();
    const recent = events.filter((e) => {
      const t = e.created_at ? new Date(e.created_at).getTime() : 0;
      return t >= since;
    });
    if (recent.length === 0) {
      return {
        status: "INVALID",
        reason: `no public GitHub activity for @${cleanUser} since dare creation`,
        source: "github",
      };
    }
    const latest = recent[0];
    return {
      status: "VALID",
      reason: `public ${latest.type ?? "activity"} on ${latest.repo?.name ?? "repository"} verified`,
      source: "github",
    };
  } catch (e) {
    return {
      status: "UNAVAILABLE",
      reason: e instanceof Error ? e.message : String(e),
      source: "github",
    };
  }
}