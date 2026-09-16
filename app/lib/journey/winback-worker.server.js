/**
 * Win-back enrollment: contacts who have gone quiet since the last sweep.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * "Inactive 90 days" has been selectable in the flow builder and available as a
 * template since before this file, but nothing ever enrolled anyone into it. A
 * merchant could build a win-back flow, publish it, and watch it sit at zero
 * forever with no indication anything was wrong. Every other trigger is driven
 * by a Shopify webhook; this one describes the *absence* of an event, so there
 * is nothing to react to and it has to be swept for.
 *
 * ── The window, and why it is not a scan ───────────────────────────────────
 * The obvious implementation — every tick, enroll everyone whose lastOrderAt is
 * older than 90 days — re-reads the same dormant population forever and leans
 * entirely on the re-entry rules to suppress the repeats. That works until a
 * flow is set to "immediate", at which point it mails the same people hourly.
 *
 * Instead each flow enrolls the contacts who *crossed* the 90-day line since it
 * last ran: lastOrderAt inside (cutoff - elapsed, cutoff]. Crossing is an event,
 * and it happens to a given contact once, so the sweep is naturally self-limiting
 * and the re-entry rules stay a backstop rather than the mechanism.
 *
 * lastEnrollmentAt on the flow is the marker. It already exists for the segment
 * worker and means the same thing here, so no schema change was needed.
 *
 * ── First run ──────────────────────────────────────────────────────────────
 * A flow that has never run has no window. Reaching back to the beginning of
 * time would enroll the shop's entire dormant history in one tick — for a shop
 * with years of orders, thousands of people receiving "we miss you" at once,
 * which is the kind of first impression a merchant does not get to take back.
 * The first sweep therefore looks back FIRST_RUN_LOOKBACK_MS only, and the
 * per-run cap bounds it further.
 */
import prisma from "../../db.server.js";
import { enrollContact } from "./journey-queue.server.js";
import {
  checkShopHealth,
  cancelReasonFor,
  SHOP_LIVE,
  SHOP_UNKNOWN,
} from "../shopify/shop-health.server.js";
import { stopShopSending } from "./shop-work.server.js";

/** The inactivity the trigger promises. The builder labels it "Inactive 90 days". */
export const INACTIVITY_DAYS = 90;
const INACTIVITY_MS = INACTIVITY_DAYS * 24 * 60 * 60 * 1000;

/**
 * How far back the very first sweep of a flow looks.
 *
 * Seven days rather than forever: a newly published flow should start working
 * for people going dormant from now on, not deliver a backlog accumulated over
 * the shop's whole history. A merchant who wants the historical cohort can
 * build a segment-triggered flow, where choosing that audience is explicit.
 */
export const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Contacts enrolled per flow per run. Bounds both API spend and blast radius. */
export const MAX_PER_FLOW_PER_RUN = 200;

/** Flows swept per tick, newest-stalest first. */
const BUDGET_PER_TICK = 10;

/**
 * Sweep published win-back flows and enroll whoever has just gone dormant.
 *
 * Leased by the caller: this has no per-row claim, so two instances would pick
 * the same flows and enroll the same contacts twice.
 */
export async function runWinbackWorker() {
  const flows = await prisma.journey.findMany({
    where: { trigger: "win_back", status: "published", archivedAt: null },
    orderBy: [{ lastEnrollmentAt: { sort: "asc", nulls: "first" } }],
    take: BUDGET_PER_TICK,
  });
  if (!flows.length) return { flows: 0, enrolled: 0 };

  let enrolled = 0;
  for (const flow of flows) {
    try {
      // A poller, not a webhook: nothing stops it firing for a shop that has
      // closed or uninstalled, so it has to ask. Same reasoning and same
      // handling as the segment enrollment worker.
      const health = await checkShopHealth(flow.shop);
      if (health === SHOP_UNKNOWN) continue; // unreachable proves nothing — retry next tick
      if (health !== SHOP_LIVE) {
        await stopShopSending(flow.shop, cancelReasonFor(health));
        console.warn(`[winback] ${flow.shop} is ${health} — flows paused, queue cleared`);
        continue;
      }
      enrolled += await sweepFlow(flow);
    } catch (err) {
      // One flow's failure must not cost the others their sweep.
      console.error(`[winback] flow ${flow.id} (${flow.shop}) failed:`, err.message);
    }
  }
  return { flows: flows.length, enrolled };
}

/**
 * Enroll the contacts of one flow's shop who crossed the inactivity line since
 * this flow last swept.
 *
 * @returns {Promise<number>} how many were enrolled
 */
async function sweepFlow(flow, now = new Date()) {
  const cutoff = new Date(now.getTime() - INACTIVITY_MS);

  // The lower bound is where the previous sweep's window ended. Without it a
  // contact dormant for a year would qualify on every tick forever.
  const since = flow.lastEnrollmentAt
    ? new Date(flow.lastEnrollmentAt.getTime() - INACTIVITY_MS)
    : new Date(cutoff.getTime() - FIRST_RUN_LOOKBACK_MS);

  const contacts = await prisma.contact.findMany({
    where: {
      shop: flow.shop,
      deletedAt: null,
      // Has ordered at least once — someone who never bought is not "inactive",
      // they are a different audience and a different flow.
      lastOrderAt: { gt: since, lte: cutoff },
    },
    select: { email: true, name: true, lastOrderAt: true },
    // Oldest first, so if the cap truncates a run the people who have been
    // dormant longest are reached first and the rest follow next tick.
    orderBy: { lastOrderAt: "asc" },
    take: MAX_PER_FLOW_PER_RUN,
  });

  let enrolled = 0;
  let lastReached = null;
  for (const contact of contacts) {
    try {
      const result = await enrollContact(flow.id, contact.email, contact.name || "", {
        lastOrderAt: contact.lastOrderAt?.toISOString() || "",
        inactiveDays: String(INACTIVITY_DAYS),
      });
      if (result) enrolled++;
      lastReached = contact.lastOrderAt;
    } catch (err) {
      console.error(`[winback] enroll failed for ${contact.email} on flow ${flow.id}:`, err.message);
    }
  }

  // Advance the marker.
  //
  // A truncated run advances only as far as the last contact actually reached,
  // so the ones the cap cut off are still inside the next window rather than
  // skipped. The stored value is the wall-clock time whose cutoff equals that
  // contact's lastOrderAt — the same arithmetic the window above reverses.
  const truncated = contacts.length === MAX_PER_FLOW_PER_RUN;
  const marker =
    truncated && lastReached ? new Date(lastReached.getTime() + INACTIVITY_MS) : now;

  await prisma.journey.update({
    where: { id: flow.id },
    data: { lastEnrollmentAt: marker },
  });

  if (enrolled || truncated) {
    console.log(
      `[winback] flow=${flow.id} shop=${flow.shop} enrolled=${enrolled}/${contacts.length}` +
        (truncated ? ` (capped at ${MAX_PER_FLOW_PER_RUN}, resuming next tick)` : ""),
    );
  }
  return enrolled;
}
