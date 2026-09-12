"server-only";

import type { DareRecord } from "@/lib/db";

export interface StravaVerdict {
  status: "VALID" | "INVALID" | "UNAVAILABLE";
  reason: string;
  source: string;
}

interface StravaActivity {
  id?: number;
  start_date?: string;
  name?: string;
  distance?: number;
  moving_time?: number;
  sport_type?: string;
  type?: string;
}

export async function runStravaAdjudication(
  dare: DareRecord,
  activityLink: string
): Promise<StravaVerdict> {
  const token = process.env.STRAVA_ACCESS_TOKEN;
  if (!token) {
    return {
      status: "UNAVAILABLE",
      reason: "STRAVA_ACCESS_TOKEN not configured",
      source: "strava",
    };
  }

  const match = activityLink.match(/strava\.com\/activities\/(\d+)/);
  const activityId = match?.[1];
  if (!activityId) {
    return {
      status: "INVALID",
      reason: "link is not a Strava activity URL",
      source: "strava",
    };
  }

  try {
    const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return { status: "INVALID", reason: "Strava activity not found", source: "strava" };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        status: "UNAVAILABLE",
        reason: `Strava API ${res.status}: token rejected or activity private`,
        source: "strava",
      };
    }
    if (!res.ok) {
      return {
        status: "UNAVAILABLE",
        reason: `Strava API ${res.status}: ${res.statusText}`,
        source: "strava",
      };
    }
    const activity = (await res.json()) as StravaActivity;
    const startedAt = activity.start_date ? new Date(activity.start_date).getTime() : 0;
    if (!startedAt) {
      return { status: "INVALID", reason: "activity has no start date", source: "strava" };
    }
    if (startedAt < new Date(dare.createdAt).getTime()) {
      return {
        status: "INVALID",
        reason: "activity predates the dare creation",
        source: "strava",
      };
    }
    const sport = activity.sport_type ?? activity.type ?? "activity";
    return {
      status: "VALID",
      reason: `Strava ${sport.toLowerCase()} "${activity.name}" on ${activity.start_date} verified`,
      source: "strava",
    };
  } catch (e) {
    return {
      status: "UNAVAILABLE",
      reason: e instanceof Error ? e.message : String(e),
      source: "strava",
    };
  }
}