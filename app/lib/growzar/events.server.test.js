/**
 * The outbox's delivery loop against a real HTTP server standing in for
 * Growzar, with an in-memory table in place of Postgres — the claim is a
 * conditional update, which the fake reproduces faithfully enough for the
 * retry path (the concurrency guarantee itself is Postgres's, as in
 * lease.db.test.js). No database is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { deliverGrowzarEvent } from "./events.server.js";
import { verifySignature } from "./signing.js";
import { buildEnvelope, EVENTS_PATH } from "./events.js";

const SECRET = "sec_outbox_0123456789abcdefghijklmn";

function fakeDb(row) {
  const table = new Map([[row.id, { status: "pending", attempts: 0, nextAttemptAt: new Date(0), ...row }]]);
  return {
    table,
    growzarOutboundEvent: {
      async updateMany({ where, data }) {
        const r = table.get(where.id);
        if (!r || r.status !== where.status || r.nextAttemptAt > where.nextAttemptAt.lte) return { count: 0 };
        r.nextAttemptAt = data.nextAttemptAt;
        r.attempts += data.attempts.increment;
        return { count: 1 };
      },
      async findUnique({ where }) {
        const r = table.get(where.id);
        return r ? { ...r } : null;
      },
      async update({ where, data }) {
        Object.assign(table.get(where.id), data);
      },
    },
  };
}

async function fakeGrowzar(statuses) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const verified = verifySignature({
        secret: SECRET,
        signature: req.headers["x-growzar-signature"],
        timestamp: req.headers["x-growzar-timestamp"],
        method: req.method,
        pathWithQuery: req.url,
        body,
        now: Number(req.headers["x-growzar-timestamp"]),
      });
      seen.push({ path: req.url, body, signed: verified.ok });
      const status = statuses.shift() ?? 202;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 202 ? { accepted: true } : { error: "boom", errorType: "internal_error" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

test("a forced 500 is retried on the schedule, then delivered with the same bytes", async (t) => {
  const growzar = await fakeGrowzar([500, 503]);
  t.after(growzar.close);
  const env = { GROWZAR_URL: growzar.url, GROWZAR_SIGNING_SECRET: SECRET };

  const envelope = buildEnvelope({ topic: "app.uninstalled", shop: "acme.myshopify.com", actor: { type: "shopify" } });
  const db = fakeDb({ id: "r1", eventId: envelope.eventId, topic: envelope.topic, shop: envelope.shop, body: JSON.stringify(envelope) });
  const row = db.table.get("r1");

  const t0 = new Date("2026-09-24T12:00:00Z");
  assert.equal(await deliverGrowzarEvent("r1", { db, env, now: t0 }), "retry");
  assert.equal(row.attempts, 1);
  assert.equal(row.lastStatus, 500);
  assert.equal(row.nextAttemptAt.getTime() - t0.getTime(), 60_000);

  // Not due yet: nothing is sent.
  assert.equal(await deliverGrowzarEvent("r1", { db, env, now: new Date(t0.getTime() + 30_000) }), "skipped");
  assert.equal(growzar.seen.length, 1);

  const t1 = new Date(t0.getTime() + 60_000);
  assert.equal(await deliverGrowzarEvent("r1", { db, env, now: t1 }), "retry");
  assert.equal(row.nextAttemptAt.getTime() - t1.getTime(), 5 * 60_000);

  const t2 = new Date(t1.getTime() + 5 * 60_000);
  assert.equal(await deliverGrowzarEvent("r1", { db, env, now: t2 }), "delivered");
  assert.equal(row.status, "delivered");
  assert.equal(row.attempts, 3);

  assert.equal(growzar.seen.length, 3);
  for (const s of growzar.seen) {
    assert.equal(s.path, EVENTS_PATH);
    assert.equal(s.signed, true);
    assert.equal(s.body, JSON.stringify(envelope));
  }
});

test("after the last retry the row is marked failed", async (t) => {
  const growzar = await fakeGrowzar(Array(10).fill(500));
  t.after(growzar.close);
  const env = { GROWZAR_URL: growzar.url, GROWZAR_SIGNING_SECRET: SECRET };
  const db = fakeDb({ id: "r2", eventId: "e2", topic: "app.uninstalled", shop: "acme.myshopify.com", body: "{}" });
  const row = db.table.get("r2");

  const outcomes = [];
  for (let i = 0; i < 7; i++) {
    outcomes.push(await deliverGrowzarEvent("r2", { db, env, now: new Date(row.nextAttemptAt.getTime()) }));
  }
  assert.deepEqual(outcomes, ["retry", "retry", "retry", "retry", "retry", "retry", "failed"]);
  assert.equal(row.status, "failed");
  assert.equal(await deliverGrowzarEvent("r2", { db, env, now: new Date(8.64e15) }), "skipped");
});

test("a 400 fails at once — resending a bad envelope changes nothing", async (t) => {
  const growzar = await fakeGrowzar([400]);
  t.after(growzar.close);
  const env = { GROWZAR_URL: growzar.url, GROWZAR_SIGNING_SECRET: SECRET };
  const db = fakeDb({ id: "r3", eventId: "e3", topic: "app.uninstalled", shop: "acme.myshopify.com", body: "{}" });
  assert.equal(await deliverGrowzarEvent("r3", { db, env }), "failed");
});

test("unconfigured: nothing is attempted and no attempt is spent", async () => {
  const db = fakeDb({ id: "r4", eventId: "e4", topic: "app.uninstalled", shop: "acme.myshopify.com", body: "{}" });
  assert.equal(await deliverGrowzarEvent("r4", { db, env: {} }), "skipped");
  assert.equal(db.table.get("r4").attempts, 0);
});
