/**
 * Loads .env into process.env. Import this FIRST, for side effect only.
 *
 * ── Why a module rather than a line of code ────────────────────────────────
 * ESM hoists imports: every statement in a module's body runs after all of its
 * imports have been evaluated. So `process.loadEnvFile()` written at the top of
 * an entrypoint still runs too late — shopify.server.js and the email adapters
 * have already been evaluated and have already read process.env. A module that
 * is imported first is the only thing that runs before them.
 *
 * ── Why not --env-file-if-exists ───────────────────────────────────────────
 * That is how both processes were meant to get .env, and neither one did: pm2
 * drops `node_args` in cluster mode AND in fork mode, so the processes come up
 * as a bare `node <script>`. It cost an outage to find (the web app bound 3000
 * while nginx proxied 3017) and it would have cost a silent one — the worker
 * sends through Resend, web push and WhatsApp, none of which would have been
 * configured.
 *
 * ── Why not rely on Prisma, which already does this ────────────────────────
 * Importing @prisma/client loads .env into process.env as a side effect, which
 * is the only reason the worker's credentials reached it at all. That is an
 * accident of import order, undocumented, and being phased out upstream. When
 * it goes, sending does not crash — it just stops working.
 */
import path from "node:path";

try {
  // Resolved against this file, not the process cwd: pm2 sets cwd for these
  // apps, but a worker started any other way should still find the file.
  process.loadEnvFile(path.join(import.meta.dirname, ".env"));
} catch (err) {
  // A missing .env is legitimate — every value can come from the real
  // environment instead. Anything else is worth seeing before the app boots
  // half-configured.
  if (err?.code !== "ENOENT") {
    console.error("[load-env] could not read .env:", err.message);
  }
}
