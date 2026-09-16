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
  code: "not_configured" | "http_error" | "invalid_response" | "timeout";
};

export type PostHogQuerySuccess = {
  ok: true;
  data: HogQLQueryResult;
};

export type PostHogQueryOutcome = PostHogQuerySuccess | PostHogQueryError;

export type RunHogQLQueryOptions = {
  /** Load-level abort (overall analytics budget). Best-effort socket cancel. */
  signal?: AbortSignal;
};

/** JS deadline for one HogQL call (fetch + body). AbortSignal is cleanup only. */
export const POSTHOG_QUERY_TIMEOUT_MS = 15_000;

function trimEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  if (err instanceof Error) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  return false;
}

function timeoutOutcome(name: string): PostHogQueryError {
  return {
    ok: false,
    error: `PostHog query timed out after ${POSTHOG_QUERY_TIMEOUT_MS / 1000}s (${name})`,
    code: "timeout",
  };
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
 *
 * Settlement is guaranteed by Promise.race, not by AbortSignal.
 */
export async function runHogQLQuery(
  query: string,
  name: string,
  options?: RunHogQLQueryOptions,
): Promise<PostHogQueryOutcome> {
  const config = getPostHogQueryConfig();
  if (!config.ok) {
    return { ok: false, error: config.error, code: "not_configured" };
  }

  const url = `${config.apiHost}/api/projects/${encodeURIComponent(config.projectId)}/query/`;
  const controller = new AbortController();
  const abortRequest = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  const parentSignal = options?.signal;
  if (parentSignal) {
    if (parentSignal.aborted) abortRequest();
    else parentSignal.addEventListener("abort", abortRequest, { once: true });
  }

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PostHogQueryError>((resolve) => {
    deadlineTimer = setTimeout(() => {
      abortRequest();
      resolve(timeoutOutcome(name));
    }, POSTHOG_QUERY_TIMEOUT_MS);
  });

  const work = (async (): Promise<PostHogQueryOutcome> => {
    try {
      const response = await fetch(url, {
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
        signal: controller.signal,
      });
      let body: Record<string, unknown> | null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch (err) {
        if (
          isTimeoutError(err) ||
          controller.signal.aborted ||
          parentSignal?.aborted
        ) {
          return timeoutOutcome(name);
        }
        return {
          ok: false,
          error: "Unexpected PostHog query response shape",
          code: "invalid_response",
        };
      }
      if (!response.ok) {
        const detail =
          (typeof body.detail === "string" && body.detail) ||
          (typeof body.error === "string" && body.error) ||
          `PostHog query failed (${response.status})`;
        return { ok: false, error: detail, code: "http_error" };
      }
      if (!Array.isArray(body.results) || !Array.isArray(body.columns)) {
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
    } catch (err) {
      if (isTimeoutError(err) || controller.signal.aborted || parentSignal?.aborted) {
        return timeoutOutcome(name);
      }
      const message = err instanceof Error ? err.message : "Network error calling PostHog";
      return { ok: false, error: message, code: "http_error" };
    }
  })();

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    parentSignal?.removeEventListener("abort", abortRequest);
  }
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
