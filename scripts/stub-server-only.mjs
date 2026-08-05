/**
 * Allow Node/tsx scripts to import Next.js `server-only` modules.
 * Next still enforces the real package in the client/server bundler.
 */
import Module from "node:module";

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad(request, parent, isMain);
};
