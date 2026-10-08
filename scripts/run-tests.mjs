/**
 * `npm test`: every unit test, plus the database tests when — and only when —
 * TEST_DATABASE_URL names a disposable database.
 *
 * The database tests used to run unconditionally, and the Prisma client they
 * import reads DATABASE_URL from .env, so `npm test` in the app directory ran
 * them against production. Each *.db.test.js now imports
 * app/test-support/db-guard.js first, which refuses to start without
 * TEST_DATABASE_URL; this runner leaves those files out instead, so a plain
 * `npm test` passes on unit tests alone and says what it skipped.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function find(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return find(p);
    return e.name.endsWith(".test.js") ? [p] : [];
  });
}

const all = find("app").sort();
const withDb = Boolean(process.env.TEST_DATABASE_URL);
const files = withDb ? all : all.filter((f) => !f.endsWith(".db.test.js"));
if (!withDb) {
  console.log(
    `[test] TEST_DATABASE_URL is not set: skipping ${all.length - files.length} database test files.`,
  );
}

// shopify.server.js refuses to construct without these. Placeholders only —
// nothing under test talks to Shopify — and never written over a real value.
const env = {
  SHOPIFY_API_KEY: "test-api-key",
  SHOPIFY_API_SECRET: "test-api-secret",
  SHOPIFY_APP_URL: "https://retainify.test",
  SCOPES: "read_customers",
  ...process.env,
  // Every child gets an explicit DATABASE_URL, so nothing falls through to the
  // live one in .env: the test database when there is one, otherwise an address
  // that cannot connect, which turns any stray query into a loud failure.
  DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://no-test-db@127.0.0.1:1/none",
};

const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", env });
process.exit(res.status ?? 1);
