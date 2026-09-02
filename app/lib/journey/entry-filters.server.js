/**
 * Entry conditions for a flow.
 *
 * ── What this adds ─────────────────────────────────────────────────────────
 * A trigger says *when* someone enters a flow. It says nothing about *who*.
 * The builder has always shown an "Only enter when these conditions are met"
 * panel with its button disabled, so the answer to "who" was always "everyone
 * the trigger fires for". A merchant wanting a win-back aimed only at
 * customers who spent over $500 had to build a segment and switch the flow to
 * the segment trigger — a workaround they had to discover unaided, and one
 * that gives up the trigger they actually wanted.
 *
 * Entry filters are the same rule tree the segment builder produces, stored on
 * Journey.entryFilters and evaluated against one contact at the moment of
 * enrollment. Reusing the structure is deliberate: `evalTreeForContact` is
 * already the single-contact matcher behind segment membership, so a rule
 * means exactly what it means in the segment builder, and the two cannot
 * drift apart.
 *
 * ── Evaluated once, at entry ───────────────────────────────────────────────
 * These are entry conditions, not standing conditions. A contact who qualifies
 * on the way in stays enrolled even if they stop qualifying an hour later —
 * dropping people mid-journey is what exit criteria are for, and a flow that
 * silently abandoned people halfway would be far harder to reason about.
 *
 * ── Why this fails closed ──────────────────────────────────────────────────
 * Two things can go wrong: there is no Contact row for the address yet, or
 * evaluation throws. In both cases we skip the enrollment.
 *
 * The asymmetry is the point. A filter is a restriction the merchant asked
 * for, in a UI whose own words are "only enter when these conditions are met".
 * Enrolling on failure sends mail to people they explicitly excluded, and does
 * it invisibly — nobody audits the sends that shouldn't have happened. Not
 * enrolling loses at most one send, leaves a log line saying so, and the
 * trigger will fire again for anyone who genuinely belongs.
 *
 * Note that a missing Contact row is rarely a race in practice: every trigger
 * path upserts the contact before enrolling. It is far more often a genuine
 * "we know nothing about this person", which is exactly the case a spend or
 * lifecycle filter is meant to exclude.
 */
import prisma from "../../db.server.js";
import { evalTreeForContact } from "../segments/evaluator.server.js";
import {
  getContactStats,
  computeLifecycle,
  normalizeEmail,
} from "../contacts/contacts.server.js";

/** A tree with no rules in it imposes no restriction. */
function isEmptyTree(tree) {
  if (!tree) return true;
  if (tree.type !== "group") return true;
  return !Array.isArray(tree.children) || tree.children.length === 0;
}

/**
 * Does this contact meet the flow's entry conditions?
 *
 * @param {string} shop
 * @param {object|null} entryFilters  Journey.entryFilters — a root group, or null
 * @param {string} contactEmail
 * @returns {Promise<{pass: boolean, reason: string}>} reason is "" when passing
 */
export async function passesEntryFilters(shop, entryFilters, contactEmail) {
  if (isEmptyTree(entryFilters)) return { pass: true, reason: "" };

  const email = normalizeEmail(contactEmail);
  if (!email) return { pass: false, reason: "no email to evaluate against" };

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop, email } },
    // Tags come as a relation because the hasTag rule reads contact.tags[].tagId.
    include: { tags: { select: { tagId: true } } },
  });
  if (!contact) {
    return { pass: false, reason: "no contact record to evaluate filters against" };
  }

  try {
    const stats = await getContactStats(shop, email);
    const lifecycle = computeLifecycle(contact, stats);
    const pass = evalTreeForContact(entryFilters, { contact, stats, lifecycle });
    return { pass, reason: pass ? "" : "did not match entry filters" };
  } catch (err) {
    return { pass: false, reason: `filter evaluation failed: ${err.message}` };
  }
}
