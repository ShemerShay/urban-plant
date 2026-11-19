import "server-only";

import { lookup as dnsLookup } from "node:dns";
import type { LookupOptions } from "node:dns";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { LookupFunction } from "node:net";
import { neon, neonConfig } from "@neondatabase/serverless";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  }
  return url;
}

/**
 * Node's fetch uses Happy Eyeballs and dials Neon's IPv6 addresses first.
 * When that route blackholes, Windows never answers the SYN, the 250ms
 * fallback does not win, and undici reports UND_ERR_CONNECT_TIMEOUT at 10s.
 * The first server render then throws NeonDbError before SQL runs. A refresh
 * often works once the OS drops the bad route and the next dial hits IPv4.
 * This shared client dials IPv4 only. SQL and HTTP errors still reject.
 */
const CONNECT_TIMEOUT_MS = 10_000;

const neonHttpAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
});

const neonIpv4Lookup: LookupFunction = (hostname, options, callback) => {
  const lookupOptions: LookupOptions = { ...options, family: 4 };
  dnsLookup(hostname, lookupOptions, callback);
};

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out.set(key, value);
    else if (Array.isArray(value)) {
      for (const item of value) out.append(key, item);
    }
  }
  return out;
}

function neonIpv4Fetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  const signal = init?.signal;
  const body = init?.body;

  return new Promise((resolve, reject) => {
    if (body != null && typeof body !== "string" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
      reject(new TypeError("Neon query body must be a string"));
      return;
    }

    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    const clearConnectTimer = () => {
      if (connectTimer === undefined) return;
      clearTimeout(connectTimer);
      connectTimer = undefined;
    };

    const req = https.request(
      url,
      {
        method: init?.method ?? "POST",
        headers: headerRecord(init?.headers),
        agent: neonHttpAgent,
        family: 4,
        autoSelectFamily: false,
        lookup: neonIpv4Lookup,
      } as https.RequestOptions,
      (res) => {
        clearConnectTimer();
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(
            new Response(text, {
              status: res.statusCode ?? 0,
              headers: responseHeaders(res.headers),
            }),
          );
        });
      },
    );

    const fail = (err: unknown) => {
      clearConnectTimer();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const onAbort = () => {
      req.destroy(new DOMException("The operation was aborted", "AbortError"));
    };

    req.on("error", fail);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    req.on("socket", (socket) => {
      if (!socket.connecting) return;
      connectTimer = setTimeout(() => {
        const err = new Error(
          `Connect Timeout Error (ipv4 ${url.hostname}:${url.port || 443}, timeout: ${CONNECT_TIMEOUT_MS}ms)`,
        );
        (err as NodeJS.ErrnoException).code = "UND_ERR_CONNECT_TIMEOUT";
        req.destroy(err);
      }, CONNECT_TIMEOUT_MS);
      connectTimer.unref();
      socket.once("connect", clearConnectTimer);
    });

    if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) req.write(body);
    req.end();
  });
}

neonConfig.fetchFunction = neonIpv4Fetch;

/** Serverless SQL client for Neon (HTTP). Use in Route Handlers and Server Components. */
export const sql = neon(getDatabaseUrl());
