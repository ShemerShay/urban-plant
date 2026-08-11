import "server-only";

/**
 * Server-only PostHog Query API (HogQL) client.
 * Never import this into client components — personal API key stays on the server.
 *
 * Docs: https://posthog.com/docs/api/queries
 */

export type HogQLQueryResult = {
  columns: string[];
  results: unknown[][];
};

export type PostHogQueryError = {
  ok: false;
  error: string;
  code: "not_configured" | "http_error" | "invalid_response";
};

export type PostHogQuerySuccess = {
  ok: true;
  data: HogQLQueryResult;
};

export type PostHogQueryOutcome = PostHogQuerySuccess | PostHogQueryError;

function trimEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** API host for `/api/projects/.../query` (not the ingest `*.i.posthog.com` host). */
export function getPostHogApiHost(): string {
  const explicit = trimEnv(process.env.POSTHOG_API_HOST);
  if (explicit) return explicit.replace(/\/$/, "");

  const ui = trimEnv(process.env.NEXT_PUBLIC_POSTHOG_UI_HOST);
  if (ui) return ui.replace(/\/$/, "");

  const ingest = trimEnv(process.env.NEXT_PUBLIC_POSTHOG_HOST).toLowerCase();
  if (ingest.includes("eu")) return "https://eu.posthog.com";
  return "https://us.posthog.com";
}

export function getPostHogQueryConfig():
  | { ok: true; apiHost: string; projectId: string; personalApiKey: string }
  | { ok: false; error: string } {
  const personalApiKey = trimEnv(process.env.POSTHOG_PERSONAL_API_KEY);
  const projectId = trimEnv(process.env.POSTHOG_PROJECT_ID);
  if (!personalApiKey || !projectId) {
    return {
      ok: false,
      error:
        "PostHog server query is not configured. Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID (server-only).",
    };
  }
  return {
    ok: true,
    apiHost: getPostHogApiHost(),
    projectId,
    personalApiKey,
  };
}

/**
 * Run a HogQL query against the project.
 * Requires a personal API key with Query Read scope.
 */
export async function runHogQLQuery(
  query: string,
  name: string,
): Promise<PostHogQueryOutcome> {
  const config = getPostHogQueryConfig();
  if (!config.ok) {
    return { ok: false, error: config.error, code: "not_configured" };
  }

  const url = `${config.apiHost}/api/projects/${encodeURIComponent(config.projectId)}/query/`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.personalApiKey}`,
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
        name,
        refresh: "blocking",
      }),
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error calling PostHog";
    return { ok: false, error: message, code: "http_error" };
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail =
      (body && typeof body.detail === "string" && body.detail) ||
      (body && typeof body.error === "string" && body.error) ||
      `PostHog query failed (${response.status})`;
    return { ok: false, error: detail, code: "http_error" };
  }

  if (!body || !Array.isArray(body.results) || !Array.isArray(body.columns)) {
    return {
      ok: false,
      error: "Unexpected PostHog query response shape",
      code: "invalid_response",
    };
  }

  return {
    ok: true,
    data: {
      columns: body.columns as string[],
      results: body.results as unknown[][],
    },
  };
}

export function hogqlRowNumber(row: unknown[], index: number): number {
  const v = row[index];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "bigint") return Number(v);
  return 0;
}

export function hogqlRowString(row: unknown[], index: number): string {
  const v = row[index];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
