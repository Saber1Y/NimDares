"server-only";

import type { DareRecord } from "@/lib/db";

export interface GithubVerdict {
  status: "VALID" | "INVALID" | "UNAVAILABLE";
  reason: string;
  source: string;
}

interface GithubCommit {
  sha?: string;
  commit?: {
    author?: { name?: string; date?: string };
    committer?: { name?: string; date?: string };
  };
  author?: { login?: string } | null;
  committer?: { login?: string } | null;
}

interface GithubPull {
  number?: number;
  user?: { login?: string } | null;
  created_at?: string;
  merged_at?: string | null;
}

interface GithubEvent {
  type?: string;
  created_at?: string;
  repo?: { name?: string };
  public?: boolean;
}

type GithubTarget =
  | { kind: "commit"; owner: string; repo: string; ref: string }
  | { kind: "pr"; owner: string; repo: string; number: string }
  | { kind: "repo"; owner: string; repo: string }
  | { kind: "profile"; user: string };

const GH_ROOT = "https://api.github.com";
const GITHUB_URL_PREFIX = /^https?:\/\/(?:www\.)?github\.com\//i;
const SAFE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function ok(reason: string): GithubVerdict {
  return { status: "VALID", reason, source: "github" };
}
function no(reason: string): GithubVerdict {
  return { status: "INVALID", reason, source: "github" };
}
function off(reason: string): GithubVerdict {
  return { status: "UNAVAILABLE", reason, source: "github" };
}

const STATUS = { VALID: ok, INVALID: no, UNAVAILABLE: off } as const;

function parseGithubTarget(raw: string): GithubTarget | null {
  const value = raw.trim();
  if (!GITHUB_URL_PREFIX.test(value)) {
    return null;
  }
  const path = value.replace(GITHUB_URL_PREFIX, "").split("?")[0].replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1 && SAFE_NAME.test(parts[0]!)) {
    return { kind: "profile", user: parts[0] };
  }
  if (parts.length >= 4 && SAFE_NAME.test(parts[0]!) && SAFE_NAME.test(parts[1]!)) {
    if ((parts[2] === "commit" || parts[2] === "commits") && parts[3]) {
      return { kind: "commit", owner: parts[0], repo: parts[1], ref: parts[3] };
    }
    if ((parts[2] === "pull" || parts[2] === "pulls") && /^\d+$/.test(parts[3]!)) {
      return { kind: "pr", owner: parts[0], repo: parts[1], number: parts[3] };
    }
  }
  if (parts.length >= 2 && SAFE_NAME.test(parts[0]!) && SAFE_NAME.test(parts[1]!)) {
    return { kind: "repo", owner: parts[0], repo: parts[1] };
  }
  return null;
}

async function gh(token: string, path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${GH_ROOT}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, json };
}

function shortSha(sha: string | undefined): string {
  return (sha ?? "unknown").slice(0, 7);
}

function sameUser(a: string, b: string): boolean {
  return a.replace(/^@/, "").trim().toLowerCase() === b.trim().toLowerCase();
}

/** Returns UNAVAILABLE when the repo is out of the token's reach, otherwise null (repo visible). */
async function repoAccess(
  token: string,
  owner: string,
  repo: string,
): Promise<GithubVerdict | null> {
  const res = await gh(token, `/repos/${owner}/${repo}`);
  if (res.status === 200) {
    return null;
  }
  if (res.status === 404) {
    return STATUS.UNAVAILABLE(
      `${owner}/${repo} is private or does not exist, and the GitHub token cannot see it. Grant repo access to the token or use a public repository.`,
    );
  }
  if (res.status === 403 || res.status === 401) {
    return STATUS.UNAVAILABLE(`GitHub API ${res.status} rejected the token`);
  }
  return STATUS.UNAVAILABLE(`GitHub API ${res.status} while checking ${owner}/${repo}`);
}

async function verifyCommit(
  token: string,
  user: string,
  owner: string,
  repo: string,
  ref: string,
  since: number,
): Promise<GithubVerdict> {
  const res = await gh(token, `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
  if (res.status === 200) {
    const commit = res.json as GithubCommit;
    const dateStr = commit.commit?.author?.date ?? commit.commit?.committer?.date;
    if (!dateStr) {
      return STATUS.UNAVAILABLE("GitHub returned a commit without a timestamp");
    }
    const login = commit.author?.login ?? commit.committer?.login;
    if (login && !sameUser(login, user)) {
      return STATUS.INVALID(`commit ${shortSha(commit.sha)} on ${owner}/${repo} is by @${login}, not @${user}`);
    }
    if (new Date(dateStr).getTime() < since) {
      return STATUS.INVALID(`commit ${shortSha(commit.sha)} on ${owner}/${repo} predates the dare start`);
    }
    return STATUS.VALID(`commit ${shortSha(commit.sha)} on ${owner}/${repo} verified`);
  }
  if (res.status === 404) {
    const access = await repoAccess(token, owner, repo);
    if (access) {
      return access;
    }
    return STATUS.INVALID(`commit ${ref} was not found in ${owner}/${repo}`);
  }
  return STATUS.UNAVAILABLE(`GitHub API ${res.status} while resolving commit ${ref}`);
}

async function verifyPull(
  token: string,
  user: string,
  owner: string,
  repo: string,
  number: string,
  since: number,
): Promise<GithubVerdict> {
  const res = await gh(token, `/repos/${owner}/${repo}/pulls/${number}`);
  if (res.status === 200) {
    const pull = res.json as GithubPull;
    const author = pull.user?.login;
    if (author && !sameUser(author, user)) {
      return STATUS.INVALID(`PR #${pull.number ?? number} on ${owner}/${repo} is by @${author}, not @${user}`);
    }
    if (!pull.created_at) {
      return STATUS.UNAVAILABLE("GitHub returned a pull request without a creation date");
    }
    if (new Date(pull.created_at).getTime() < since) {
      return STATUS.INVALID(`PR #${pull.number ?? number} on ${owner}/${repo} was created before the dare start`);
    }
    const merged = pull.merged_at ? " (merged)" : "";
    return STATUS.VALID(`PR #${pull.number ?? number} on ${owner}/${repo} verified${merged}`);
  }
  if (res.status === 404) {
    const access = await repoAccess(token, owner, repo);
    if (access) {
      return access;
    }
    return STATUS.INVALID(`PR #${number} was not found in ${owner}/${repo}`);
  }
  return STATUS.UNAVAILABLE(`GitHub API ${res.status} while resolving PR #${number}`);
}

async function verifyRepo(
  token: string,
  user: string,
  owner: string,
  repo: string,
  since: number,
): Promise<GithubVerdict> {
  const sinceIso = new Date(since).toISOString();
  const res = await gh(
    token,
    `/repos/${owner}/${repo}/commits?author=${encodeURIComponent(user)}&since=${encodeURIComponent(sinceIso)}&per_page=1`,
  );
  if (res.status === 200) {
    const commits = res.json as GithubCommit[];
    if (!Array.isArray(commits) || commits.length === 0) {
      return STATUS.INVALID(`no commits by @${user} in ${owner}/${repo} since the dare start`);
    }
    const sha = shortSha(commits[0]?.sha);
    return STATUS.VALID(`commit ${sha} on ${owner}/${repo} by @${user}`);
  }
  if (res.status === 404) {
    const access = await repoAccess(token, owner, repo);
    if (access) {
      return access;
    }
    return STATUS.INVALID(`no commits found for ${owner}/${repo}`);
  }
  if (res.status === 422) {
    // author/since combination not resolvable for the repo's contributors
    return STATUS.UNAVAILABLE(`could not list commits for ${owner}/${repo} authored by @${user}`);
  }
  return STATUS.UNAVAILABLE(`GitHub API ${res.status} while listing commits for ${owner}/${repo}`);
}

async function verifyRecentActivity(
  token: string,
  user: string,
  since: number,
): Promise<GithubVerdict> {
  try {
    const res = await fetch(`${GH_ROOT}/users/${encodeURIComponent(user)}/events/public`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return STATUS.INVALID(`GitHub user @${user} not found`);
    }
    if (res.status === 403 || res.status === 401) {
      return STATUS.UNAVAILABLE(`GitHub API ${res.status}: ${res.statusText}`);
    }
    if (!res.ok) {
      return STATUS.UNAVAILABLE(`GitHub API ${res.status}: ${res.statusText}`);
    }
    const events = (await res.json()) as GithubEvent[];
    const recent = events.filter((e) => {
      const t = e.created_at ? new Date(e.created_at).getTime() : 0;
      return t >= since;
    });
    if (recent.length === 0) {
      return STATUS.INVALID(`no public GitHub activity for @${user} since the dare start`);
    }
    const latest = recent[0]!;
    return STATUS.VALID(`public ${latest.type ?? "activity"} on ${latest.repo?.name ?? "repository"} verified`);
  } catch (e) {
    return STATUS.UNAVAILABLE(e instanceof Error ? e.message : String(e));
  }
}

export async function runGithubAdjudication(
  dare: DareRecord,
  username: string,
): Promise<GithubVerdict> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return STATUS.UNAVAILABLE("GITHUB_TOKEN not configured");
  }
  const cleanUser = username.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9-]{1,39}$/.test(cleanUser)) {
    return STATUS.INVALID("malformed GitHub username");
  }

  const since = new Date(dare.createdAt).getTime();
  // Solo dares carry the submitted URL in verifierResult.observations (no
  // dedicated column); seats carry it on proofLink.
  const target = (dare.proofLink ?? dare.verifierResult?.observations ?? "").trim();

  if (!target) {
    // No specific artifact was submitted (e.g. a sweep ruling): fall back to
    // any public activity since the dare started.
    return verifyRecentActivity(token, cleanUser, since);
  }
  const parsed = parseGithubTarget(target);
  if (!parsed) {
    return STATUS.INVALID("proof link is not a github.com URL");
  }

  try {
    switch (parsed.kind) {
      case "commit":
        return await verifyCommit(token, cleanUser, parsed.owner, parsed.repo, parsed.ref, since);
      case "pr":
        return await verifyPull(token, cleanUser, parsed.owner, parsed.repo, parsed.number, since);
      case "repo":
        return await verifyRepo(token, cleanUser, parsed.owner, parsed.repo, since);
      case "profile":
        if (!sameUser(parsed.user, cleanUser)) {
          return STATUS.INVALID(`proof link points to @${parsed.user}, not @${cleanUser}`);
        }
        return await verifyRecentActivity(token, cleanUser, since);
    }
  } catch (e) {
    return STATUS.UNAVAILABLE(e instanceof Error ? e.message : String(e));
  }

  return STATUS.UNAVAILABLE("unable to adjudicate GitHub proof");
}