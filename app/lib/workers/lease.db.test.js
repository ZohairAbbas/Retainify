/**
 * Worker leases — the mutual exclusion the periodic workers depend on.
 *
 * Run: npm test   (or: node --test app/lib/workers/lease.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The whole mechanism is one conditional UPDATE and one INSERT, and what makes
 * it a lock is Postgres evaluating the predicate under a row lock. In-process
 * there is nothing to test: a mocked prisma would return whatever it was told
 * to, including "you won" for both callers.
 *
 * The cases that matter are the ones a single-process test would never reach —
 * two holders racing for the same name at the same instant, and a holder that
 * overran its TTL trying to release a lease somebody else now owns.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import {
  acquireLease,
  releaseLease,
  withLease,
  HOLDER_ID,
} from "./lease.server.js";

const NAME = "__test__lease";

async function clear() {
  await prisma.workerLease.deleteMany({ where: { name: { startsWith: "__test__" } } });
}

test.before(clear);
test.after(async () => {
  await clear();
  await prisma.$disconnect();
});

test("the first caller takes the lease and the second is refused", async (t) => {
  t.after(clear);
  assert.equal(await acquireLease(NAME, 60_000), true);
  // Same process, so this is the "already held" path rather than a race — the
  // holder check must not let a process re-take its own live lease, or the
  // in-process overlap guard would be the only thing preventing a double run.
  assert.equal(await acquireLease(NAME, 60_000), false);
});

test("releasing frees it immediately rather than waiting out the TTL", async (t) => {
  t.after(clear);
  await acquireLease(NAME, 60 * 60_000);
  assert.equal(await releaseLease(NAME), true);
  assert.equal(await acquireLease(NAME, 60_000), true);
});

test("an expired lease is taken over, so a dead holder costs one interval", async (t) => {
  t.after(clear);
  await prisma.workerLease.create({
    data: {
      name: NAME,
      holder: "some-host:999:dead",
      acquiredAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  assert.equal(await acquireLease(NAME, 60_000), true);
  const row = await prisma.workerLease.findUnique({ where: { name: NAME } });
  assert.equal(row.holder, HOLDER_ID);
});

test("a holder that overran its TTL cannot release the lease that replaced it", async (t) => {
  t.after(clear);
  // This process takes it, then someone else takes over after it expires —
  // exactly what a tick running longer than its TTL looks like.
  await acquireLease(NAME, 60_000);
  await prisma.workerLease.update({
    where: { name: NAME },
    data: { holder: "another-host:1:live", expiresAt: new Date(Date.now() + 60_000) },
  });

  // The slow tick finishes and releases. It must not free a lease that is
  // actively held by the process that took over, or the two run concurrently.
  assert.equal(await releaseLease(NAME), false);
  const row = await prisma.workerLease.findUnique({ where: { name: NAME } });
  assert.equal(row.holder, "another-host:1:live");
  assert.ok(row.expiresAt > new Date(), "the live holder's lease must still be in force");
});

test("exactly one of several simultaneous callers runs the work", async (t) => {
  t.after(clear);
  // The race the whole module exists for. Every caller is in this process, but
  // the arbitration happens in Postgres, which is where it happens in
  // production too — the requests interleave on separate pooled connections.
  let ran = 0;
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      withLease(NAME, async () => {
        ran++;
        await new Promise((r) => setTimeout(r, 20));
      }, { ttlMs: 60_000 }),
    ),
  );
  assert.equal(ran, 1, "the work ran more than once");
  assert.equal(attempts.filter((a) => a.ran).length, 1);
});

test("the lease is released when the work throws", async (t) => {
  t.after(clear);
  await assert.rejects(
    withLease(NAME, () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  // A lease held to its TTL by a crash would stall the worker for minutes; the
  // finally clause is what keeps a failing worker retrying on the next tick.
  assert.equal(await acquireLease(NAME, 60_000), true);
});
