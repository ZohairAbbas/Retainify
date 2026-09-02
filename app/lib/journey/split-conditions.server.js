/**
 * Deciding which way an enrollment goes at a split.
 *
 * ── Scope right now ────────────────────────────────────────────────────────
 * Contact attributes only: the same rule tree the segment builder produces,
 * evaluated by the same evalTreeForContact(). Reusing it is deliberate and is
 * the same argument entry-filters.server.js makes — a rule means exactly what
 * it means in the segment builder, and the two cannot drift apart.
 *
 * In-flow engagement ("opened the email two steps back", "clicked it") is the
 * other half of what a split is for, and lands in phase 4. It needs its own
 * rule family resolved against this enrollment's own jobs rather than against
 * the contact, so it is a genuine addition rather than more fields in this
 * catalog. Until then a split can ask who someone is, but not what they did.
 *
 * ── Why an unevaluable condition takes the No branch ────────────────────────
 * Two things can go wrong: there is no Contact row for the address, or
 * evaluation throws. Both resolve to false, and the enrollment continues down
 * the No branch.
 *
 * This is the opposite of the choice entry filters make, and deliberately so.
 * An entry filter failing closed costs one send that the trigger will offer
 * again. A split failing closed would drop somebody out of the middle of a
 * flow they are already in — silently, with no job to show for it, which is
 * the single hardest kind of bug to notice in this system. Continuing down the
 * conservative branch keeps them moving and leaves a log line saying why.
 *
 * In practice the No branch is also the harmless one: it is normally the
 * re-engagement path, and a contact we know nothing about is exactly who that
 * path is for.
 */

import prisma from "../../db.server.js";
import { evalTreeForContact } from "../segments/evaluator.server.js";
import {
  getContactStats,
  computeLifecycle,
  normalizeEmail,
} from "../contacts/contacts.server.js";
import { isEmptyCondition } from "./graph.server.js";

/**
 * Which branch does this enrollment take?
 *
 * Never throws. A split that cannot answer still has to answer.
 *
 * @param {{ shop: string, enrollment: object, step: object, graph: object }} input
 * @returns {Promise<{ matched: boolean, reason: string }>}
 */
export async function evaluateSplit({ shop, enrollment, step }) {
  const tree = step.splitCondition;

  // An empty condition matches everybody, which is never what the merchant saw
  // on screen. validateGraph blocks publishing one, so reaching here means the
  // flow was published before that rule existed or edited around it.
  if (isEmptyCondition(tree)) {
    return { matched: false, reason: "no condition set — taking the No branch" };
  }

  const email = normalizeEmail(enrollment.contactEmail);
  if (!email) return { matched: false, reason: "no email to evaluate against" };

  try {
    const contact = await prisma.contact.findUnique({
      where: { shop_email: { shop, email } },
      // Tags come as a relation because the hasTag rule reads contact.tags[].tagId.
      include: { tags: { select: { tagId: true } } },
    });
    if (!contact) {
      return { matched: false, reason: "no contact record to evaluate against" };
    }

    const stats = await getContactStats(shop, email);
    const lifecycle = computeLifecycle(contact, stats);
    const matched = Boolean(evalTreeForContact(tree, { contact, stats, lifecycle }));
    return { matched, reason: matched ? "matched" : "did not match" };
  } catch (err) {
    console.error(
      `[split] enrollment ${enrollment.id} step ${step.stepNumber} — evaluation failed, taking No: ${err.message}`,
    );
    return { matched: false, reason: `evaluation failed: ${err.message}` };
  }
}
