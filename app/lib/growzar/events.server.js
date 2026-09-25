/**
 * Posting events to Growzar (API-CONTRACT §2.2, §7) through a durable outbox.
 *
 *   enqueueGrowzarEvent()     write the row — call this from the code path
 *                             where the thing happened
 *   deliverGrowzarEvent(id)   one attempt at one row, now
 *   runGrowzarEventWorker()   the worker tick: every due row
 *
 * Phase 1 emits only app.uninstalled (webhooks.app.uninstalled.jsx). The
 * outbox is topic-agnostic so R2's events reuse it unchanged.
 *
 * With Growzar not configured (no GROWZAR_URL or secret), rows are still
 * written and simply wait: nothing is attempted and no attempt is spent, so
 * configuring Growzar later delivers the backlog instead of losing it.
 */
import prisma from "../../db.server.js";
import { growzarConfig } from "./config.js";
import { signedHeaders } from "./signing.js";
import { EVENTS_PATH, MAX_ATTEMPTS, buildEnvelope, classifyResponse, nextRetryAt } from "./events.js";

/** Writes to Growzar time out at 30 s (§2); an event post is small, 10 s is plenty. */
const POST_TIMEOUT_MS = 10_000;
/**
 * How far a claim pushes nextAttemptAt. Longer than an attempt can take, so a
 * second process cannot take the row mid-post; short enough that a process
 * killed mid-post only delays the event by this much.
 */
const CLAIM_MS = 2 * 60 * 1000;
const BATCH = 50;

/**
 * Pass a deterministic `eventId` when the source can repeat itself — Shopify
 * redelivers a webhook with the same webhook id — and the repeat is absorbed
 * here instead of becoming a second event.
 *
 * @param {{ topic: string, shop: string, occurredAt?: Date|string, actor?: object|null, data?: object, eventId?: string }} event
 * @returns {Promise<{ id: string, eventId: string, created: boolean }>}
 */
export async function enqueueGrowzarEvent(event) {
  const envelope = buildEnvelope(event);
  try {
    const row = await prisma.growzarOutboundEvent.create({
      data: {
        eventId: envelope.eventId,
        topic: envelope.topic,
        shop: envelope.shop,
        body: JSON.stringify(envelope),
      },
      select: { id: true, eventId: true },
    });
    return { ...row, created: true };
  } catch (err) {
    if (err?.code !== "P2002") throw err;
    const existing = await prisma.growzarOutboundEvent.findUnique({
      where: { eventId: envelope.eventId },
      select: { id: true, eventId: true },
    });
    return { ...existing, created: false };
  }
}

/**
 * Claim a row: only if it is still pending and due. The conditional update is
 * the lock — a second caller updates zero rows and backs off.
 */
async function claim(db, id, now) {
  const { count } = await db.growzarOutboundEvent.updateMany({
    where: { id, status: "pending", nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS), attempts: { increment: 1 } },
  });
  return count === 1;
}

/**
 * One attempt at one row. Safe to call from anywhere, any number of times.
 *
 * `db`, `env` and `now` are injectable for tests; production passes nothing.
 *
 * @returns {Promise<"delivered"|"retry"|"failed"|"skipped">}
 */
export async function deliverGrowzarEvent(id, { fetchImpl = fetch, db = prisma, env = process.env, now = new Date() } = {}) {
  const { url, signingSecret } = growzarConfig(env);
  if (!url || !signingSecret) return "skipped";

  if (!(await claim(db, id, now))) return "skipped";

  const row = await db.growzarOutboundEvent.findUnique({ where: { id } });
  if (!row) return "skipped";

  let status = null;
  let error = null;
  try {
    const response = await fetchImpl(`${url}${EVENTS_PATH}`, {
      method: "POST",
      headers: signedHeaders({ secret: signingSecret, method: "POST", pathWithQuery: EVENTS_PATH, body: row.body, now: now.getTime() }),
      body: row.body,
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      redirect: "manual",
    });
    status = response.status;
    if (!response.ok) error = (await response.text().catch(() => "")).slice(0, 500);
  } catch (err) {
    error = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : "network error";
  }

  const outcome = classifyResponse(status);
  const retryAt = outcome === "retry" ? nextRetryAt(row.attempts, now.getTime()) : null;
  const final = outcome === "retry" && !retryAt ? "failed" : outcome;

  await db.growzarOutboundEvent.update({
    where: { id },
    data:
      final === "delivered"
        ? { status: "delivered", deliveredAt: now, lastStatus: status, lastError: null }
        : final === "failed"
          ? { status: "failed", lastStatus: status, lastError: error }
          : { nextAttemptAt: retryAt, lastStatus: status, lastError: error },
  });

  if (final === "failed") {
    console.error(
      `[growzar] ${row.topic} for ${row.shop} (${row.eventId}) failed after ${row.attempts}/${MAX_ATTEMPTS} attempts — last status ${status ?? "network"}`,
    );
  } else if (final === "retry") {
    console.warn(`[growzar] ${row.topic} for ${row.shop} attempt ${row.attempts} got ${status ?? "network error"}; retry at ${retryAt.toISOString()}`);
  }
  return final;
}

/** Worker tick: attempt every due row, oldest first. */
export async function runGrowzarEventWorker() {
  const { url, signingSecret } = growzarConfig();
  if (!url || !signingSecret) return;

  const due = await prisma.growzarOutboundEvent.findMany({
    where: { status: "pending", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH,
    select: { id: true },
  });
  for (const { id } of due) {
    await deliverGrowzarEvent(id);
  }
}
