/**
 * Canonical local dev: Webpack on port 3000, exclusive bind, no leftover Turbopack cache.
 * Run via `npm run dev`.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_PORT = 3000;
const turbopackCache = path.join(root, ".next", "dev", "cache", "turbopack");

function portInUse(host, listenPort) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: listenPort });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const requestedPort = process.env.PORT;
if (
  requestedPort !== undefined &&
  requestedPort !== "" &&
  String(requestedPort) !== String(CANONICAL_PORT)
) {
  console.error(
    `npm run dev always uses port ${CANONICAL_PORT}. Refusing PORT=${requestedPort}.`,
  );
  process.exit(1);
}

const busy =
  (await portInUse("127.0.0.1", CANONICAL_PORT)) ||
  (await portInUse("::1", CANONICAL_PORT));
if (busy) {
  console.error(
    `Port ${CANONICAL_PORT} is already in use. Stop that process, then run npm run dev again.`,
  );
  process.exit(1);
}

if (existsSync(turbopackCache)) {
  console.log("Removing leftover Turbopack cache so Webpack can register all routes.");
  rmSync(path.join(root, ".next"), { recursive: true, force: true });
}

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [nextCli, "dev", "--webpack", "--port", String(CANONICAL_PORT)],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(CANONICAL_PORT) },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
