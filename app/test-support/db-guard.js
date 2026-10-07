/**
 * Point a database test at the disposable test database, or refuse to run it.
 *
 * Import this FIRST in every *.db.test.js, for side effect only. ESM evaluates
 * imports in order, so it runs before db.server.js constructs the Prisma client.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * The repo's .env names the live database, and both Prisma and load-env.js read
 * it as soon as they are imported. A plain `npm test` in the app directory used
 * to run every database test against production. Each test cleans up after
 * itself, but "it deleted its own rows" is not a standard for live data.
 *
 * TEST_DATABASE_URL is the only way in. It is copied to DATABASE_URL before
 * anything else reads the environment, and neither Prisma nor
 * process.loadEnvFile overwrites a variable that is already set, so .env can no
 * longer win.
 */
/* global process */
import fs from "node:fs";
import path from "node:path";

const target = process.env.TEST_DATABASE_URL;
if (!target) {
  throw new Error(
    "Database tests need TEST_DATABASE_URL pointing at a disposable database. " +
      "Run them with `TEST_DATABASE_URL=... npm test`; without it they are skipped.",
  );
}

// Refuse the one mistake that matters: a test URL that is the live one.
const envFile = path.join(import.meta.dirname, "..", "..", ".env");
if (fs.existsSync(envFile)) {
  const live = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(fs.readFileSync(envFile, "utf8"))?.[1];
  const strip = (u) => String(u).split("?")[0].replace(/\/+$/, "");
  if (live && strip(live) === strip(target)) {
    throw new Error("TEST_DATABASE_URL is the database named in .env. Refusing to run tests against it.");
  }
}

process.env.DATABASE_URL = target;
