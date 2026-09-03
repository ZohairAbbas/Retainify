/**
 * Applying a flow's tag action to one contact.
 *
 * ── The first step that writes ─────────────────────────────────────────────
 * Every other node either sends something or decides something. This one
 * changes the contact record, which is what closes the loop between flows and
 * segments: a flow tags, a segment collects the tagged, and the next flow
 * targets that segment — or gates entry on it through FB-2's filters.
 *
 * ── Why failure never stops the flow ───────────────────────────────────────
 * A tag that fails to apply is a bookkeeping loss. The contact is mid-sequence
 * and the messages still make sense without the label, so stopping here would
 * turn a small problem into a silent one: the merchant would see a flow that
 * stopped sending, with no failed job to explain it.
 *
 * This is the opposite of the rule for a failed EMAIL, which does end the
 * flow — because there the narrative genuinely broke. Nothing downstream reads
 * back "did the tag apply", so nothing downstream is wrong without it.
 *
 * ── Recording where the tag came from ──────────────────────────────────────
 * Every row written here carries the step's stable key. To the merchant a tag
 * is a tag however it arrived — the contact page shows one list — but the two
 * are not the same thing to repair. A flow that mis-tags four thousand people
 * overnight otherwise leaves no way to find which rows it touched, and
 * "remove this tag from everyone" would strip the ones a human applied on
 * purpose along with them.
 *
 * The KEY rather than the step id: saveDraft recreates every step row on each
 * edit, so an id here would go stale the first time the merchant opened the
 * flow. The key is what survives, and it is what every report already groups
 * on.
 */

import prisma from "../../db.server.js";
import { normalizeEmail } from "../contacts/contacts.server.js";

export const ADD = "add";
export const REMOVE = "remove";

/**
 * Add or remove this step's tag on the enrolled contact.
 *
 * Never throws. The walk continues whatever happens here.
 *
 * @param {{ shop: string, contactEmail: string }} enrollment
 * @param {{ tagId: string, tagAction: string, stepKey: string, stepNumber: number }} step
 * @returns {Promise<{ ok: boolean, action: string, reason: string }>}
 */
export async function applyTagAction(enrollment, step) {
  const action = step.tagAction === REMOVE ? REMOVE : ADD;
  const done = (ok, reason) => ({ ok, action, reason });

  if (!step.tagId) return done(false, "no tag chosen");

  const email = normalizeEmail(enrollment.contactEmail);
  if (!email) return done(false, "no email to resolve a contact from");

  try {
    // The tag has to belong to this shop. Without the check a hand-edited or
    // duplicated flow could carry a tag id from another workspace and write it
    // onto this one's contacts — a tenancy leak through a field the merchant
    // never sees.
    const [contact, tag] = await Promise.all([
      prisma.contact.findUnique({
        where: { shop_email: { shop: enrollment.shop, email } },
        select: { id: true },
      }),
      prisma.tag.findFirst({
        where: { id: step.tagId, shop: enrollment.shop },
        select: { id: true, name: true },
      }),
    ]);

    if (!contact) return done(false, "no contact record to tag");
    if (!tag) return done(false, "that tag no longer exists on this shop");

    if (action === REMOVE) {
      // Removes the tag however it was applied. A merchant who asks a flow to
      // remove a label means "this person should not carry it", not "undo only
      // what a flow did" — the source column is for repairing a flow's own
      // mistakes, not for narrowing what it was told to do.
      const { count } = await prisma.contactTag.deleteMany({
        where: { contactId: contact.id, tagId: tag.id },
      });
      return done(true, count ? `removed "${tag.name}"` : `"${tag.name}" was not applied`);
    }

    // Upsert rather than create: a contact re-entering the flow, or a retry,
    // must not fail on the composite primary key. The update is deliberately
    // empty — re-tagging someone should not move the original timestamp or
    // reassign a tag a person applied by hand to this step.
    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
      create: {
        contactId: contact.id,
        tagId: tag.id,
        appliedByStepKey: step.stepKey || null,
      },
      update: {},
    });
    return done(true, `added "${tag.name}"`);
  } catch (err) {
    // Logged rather than thrown. See the header: a tag is not worth ending a
    // flow over, and a thrown error here would strand the contact.
    console.error(
      `[tag-action] enrollment for ${enrollment.contactEmail} step ${step.stepNumber} — ${action} failed: ${err.message}`,
    );
    return done(false, `failed: ${err.message}`);
  }
}
