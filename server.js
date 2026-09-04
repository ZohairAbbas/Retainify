/**
 * Web server entrypoint — loads .env, then hands off to react-router-serve.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 * pm2 drops `node_args`, so --env-file-if-exists never reaches the process, and
 * it drops `args`, so the build path has to be supplied here too. Loading .env
 * in code rather than expanding it into the pm2 config also keeps the secrets
 * out of ~/.pm2/dump.pm2, which pm2 writes in plaintext.
 *
 * This cannot live inside the app: ESM hoists imports, so a statement in
 * entry.server.jsx's body runs after shopify.server.js has already read
 * process.env. It has to be a separate entrypoint.
 */
// First, and by side effect: this must be evaluated before anything that reads
// process.env at module scope. See load-env.js for why it is a module.
import "./load-env.js";

import path from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;

// The CLI takes the build path as argv[2] and exits with a usage message
// without it — and cluster mode drops the `args` from the pm2 config, so it has
// to be supplied here. Absolute, because the CLI resolves it against the
// process cwd and a worker's cwd is not guaranteed to be the app directory.
if (!process.argv[2]) {
  process.argv[2] = path.join(here, "build/server/index.js");
}

await import(pathToFileURL(path.join(here, "node_modules/@react-router/serve/dist/cli.js")).href);
