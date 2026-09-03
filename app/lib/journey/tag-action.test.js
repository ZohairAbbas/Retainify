/**
 * The tag action node, end to end.
 *
 * Run: npm test — needs a database.
 *
 * This is the first node that writes to the contact record, so its failure
 * modes are different from every other step's. A send that fails leaves a
 * failed job; a tag that fails leaves nothing at all. The tests below are
 * mostly about what happens when it cannot do its job — because the rule is
 * that the flow carries on regardless, and a rule like that is only safe if it
 * is actually implemented rather than assumed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { saveDraft } from "./journey-lifecycle.server.js";
import { advanceEnrollment, createLazyEnrollment } from "./advance.server.js";
import { markJourneyJobDone } from "./journey-queue.server.js";
import { validateFlowForPublish } from "./flow-validation.server.js";
import { applyTagAction, ADD, REMOVE } from "./tag-action.server.js";
import { serializeTree, TRIGGER_ID } from "./canvas-tree.js";
import { loadGraph, rootId, NEXT, ARM_A, ARM_B, BY_CHANCE } from "./graph.server.js";

const SHOP = "__tag-test.myshopify.com";
const OTHER_SHOP = "__tag-other.myshopify.com";

const toStep = (n) => {
  const key = n.stepKey ? { stepKey: n.stepKey } : {};
  if (n.kind === "exit") return { ...key, nodeType: "exit" };
  if (n.kind === "tag") {
    return { ...key, nodeType: "tag", emailName: n.emailName || "", tagId: n.tagId, tagAction: n.tagAction };
  }
  if (n.kind === "split") {
    return {
      ...key, nodeType: "split", emailName: n.emailName || "",
      splitMode: n.splitMode, splitWeight: n.splitWeight, splitMetric: n.splitMetric,
      splitCondition: n.splitCondition ?? null,
    };
  }
  return { ...key, nodeType: "email", emailName: n.emailName, subject: n.emailName, emailBlocks: "[]" };
};

const em = (name) => ({ kind: "email", emailName: name });

async function makeFlow(nodes) {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "tagged", trigger: "customer_created", status: "published" },
  });
  const { steps, edges } = serializeTree(nodes, toStep);
  await saveDraft(journey.id, { steps, edges });
  return journey;
}

/** email → tag → exit */
const taggingFlow = (tagId, tagAction = ADD) => [
  { kind: "trigger", id: TRIGGER_ID },
  { ...em("hello"), id: "e", parentId: TRIGGER_ID, branch: NEXT },
  { kind: "tag", id: "t", parentId: "e", branch: NEXT, emailName: "Mark as engaged", tagId, tagAction },
  { ...em("after"), id: "a", parentId: "t", branch: NEXT },
  { kind: "exit", id: "x", parentId: "a", branch: NEXT },
];

async function makeContact(email, shop = SHOP) {
  return prisma.contact.create({ data: { shop, email, subscriptionStatus: "subscribed" } });
}

async function enroll(journey, email) {
  const graph = await loadGraph(journey.id);
  const root = rootId(graph);
  return createLazyEnrollment({
    journey, contactEmail: email, contactName: "", payloadObj: {},
    rootStepId: root, rootStepKey: graph.steps.get(root)?.stepKey,
  });
}

/** Send the first email, settle it, and let the walk reach the tag node. */
async function runPastTag(journey, email) {
  const e = await enroll(journey, email);
  await advanceEnrollment(e.id);
  const [job] = await prisma.journeyJob.findMany({ where: { enrollmentId: e.id } });
  await markJourneyJobDone(job.id, { sentAt: new Date() });
  const verdict = await advanceEnrollment(e.id);
  return { enrollment: e, verdict };
}

const cleanup = async () => {
  await prisma.journey.deleteMany({ where: { shop: { in: [SHOP, OTHER_SHOP] } } });
  await prisma.contact.deleteMany({ where: { shop: { in: [SHOP, OTHER_SHOP] } } });
  await prisma.tag.deleteMany({ where: { shop: { in: [SHOP, OTHER_SHOP] } } });
};

test.before(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ── The write ──────────────────────────────────────────────────────────────

test("a tag node tags the contact and the walk carries straight on", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Engaged", nameKey: "engaged" } });
  const contact = await makeContact("tagme@b.co");
  const j = await makeFlow(taggingFlow(tag.id));

  const { enrollment, verdict } = await runPastTag(j, "tagme@b.co");

  // A tag node schedules nothing, so the same pass must reach the next send.
  // Stopping on it would leave no wake time and no job — a stall.
  assert.equal(verdict.verdict, "sending");
  const jobs = await prisma.journeyJob.findMany({
    where: { enrollmentId: enrollment.id }, include: { step: true },
  });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].step.emailName, "after");

  const row = await prisma.contactTag.findUnique({
    where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
  });
  assert.ok(row, "the tag should be applied");
  assert.ok(row.appliedByStepKey, "and recorded as applied by a flow step");
});

test("the source key identifies which step tagged them", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Src", nameKey: "src" } });
  const contact = await makeContact("src@b.co");
  const j = await makeFlow(taggingFlow(tag.id));
  await runPastTag(j, "src@b.co");

  const step = await prisma.journeyStep.findFirst({ where: { journeyId: j.id, nodeType: "tag" } });
  const row = await prisma.contactTag.findFirst({ where: { contactId: contact.id } });
  assert.equal(row.appliedByStepKey, step.stepKey);

  // Which is the whole point: a flow's own tagging can be found and undone
  // without touching what a person applied by hand.
  const byFlow = await prisma.contactTag.count({ where: { appliedByStepKey: step.stepKey } });
  assert.equal(byFlow, 1);
});

test("a hand-applied tag has no source, and re-tagging does not claim it", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Manual", nameKey: "manual" } });
  const contact = await makeContact("manual@b.co");
  // Applied by a person first.
  await prisma.contactTag.create({ data: { contactId: contact.id, tagId: tag.id } });

  const j = await makeFlow(taggingFlow(tag.id));
  await runPastTag(j, "manual@b.co");

  const row = await prisma.contactTag.findUnique({
    where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
  });
  assert.equal(row.appliedByStepKey, null, "a flow must not take credit for a human's tag");
});

test("remove takes the tag off however it was applied", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Gone", nameKey: "gone" } });
  const contact = await makeContact("gone@b.co");
  await prisma.contactTag.create({ data: { contactId: contact.id, tagId: tag.id } });

  const j = await makeFlow(taggingFlow(tag.id, REMOVE));
  await runPastTag(j, "gone@b.co");

  const row = await prisma.contactTag.findFirst({ where: { contactId: contact.id, tagId: tag.id } });
  assert.equal(row, null);
});

test("re-entering the flow does not fail on the second tagging", async () => {
  // The join table has a composite primary key, so a plain create would throw
  // — and a throw here would strand a contact mid-flow.
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Twice", nameKey: "twice" } });
  const contact = await makeContact("twice@b.co");
  const j = await makeFlow(taggingFlow(tag.id));

  await runPastTag(j, "twice@b.co");
  const { verdict } = await runPastTag(j, "twice@b.co");
  assert.equal(verdict.verdict, "sending", "the second run must reach the next send too");
  assert.equal(await prisma.contactTag.count({ where: { contactId: contact.id } }), 1);
});

// ── Failing safely ─────────────────────────────────────────────────────────

test("a deleted tag does not stop the flow", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Doomed", nameKey: "doomed" } });
  await makeContact("survives@b.co");
  const j = await makeFlow(taggingFlow(tag.id));
  await prisma.tag.delete({ where: { id: tag.id } });

  const { enrollment, verdict } = await runPastTag(j, "survives@b.co");
  // The messages still make sense without the label, so the flow continues.
  // Ending it would turn a bookkeeping loss into a contact who silently stops
  // hearing from the merchant.
  assert.equal(verdict.verdict, "sending");
  assert.equal((await prisma.journeyEnrollment.findUnique({ where: { id: enrollment.id } })).exitReason, "");
});

test("no contact record does not stop the flow", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Ghost", nameKey: "ghost" } });
  const j = await makeFlow(taggingFlow(tag.id));
  // Enrolled without ever creating a Contact row.
  const { verdict } = await runPastTag(j, "nocontact@b.co");
  assert.equal(verdict.verdict, "sending");
});

test("a tag belonging to another shop is refused", async () => {
  // Tenancy: a duplicated or hand-edited flow could carry a foreign tag id,
  // and writing it would put another workspace's label on this one's contacts.
  const foreign = await prisma.tag.create({
    data: { shop: OTHER_SHOP, name: "Theirs", nameKey: "theirs" },
  });
  const contact = await makeContact("tenant@b.co");
  const result = await applyTagAction(
    { shop: SHOP, contactEmail: "tenant@b.co" },
    { tagId: foreign.id, tagAction: ADD, stepKey: "sk_x", stepNumber: 1 },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /no longer exists on this shop/);
  assert.equal(await prisma.contactTag.count({ where: { contactId: contact.id } }), 0);
});

test("applyTagAction never throws", async () => {
  for (const step of [
    { tagId: null, tagAction: ADD, stepKey: "k", stepNumber: 1 },
    { tagId: "does-not-exist", tagAction: ADD, stepKey: "k", stepNumber: 1 },
    { tagId: "x", tagAction: REMOVE, stepKey: "k", stepNumber: 1 },
  ]) {
    const r = await applyTagAction({ shop: SHOP, contactEmail: "nobody@b.co" }, step);
    assert.equal(r.ok, false);
    assert.ok(typeof r.reason === "string" && r.reason.length);
  }
  const noEmail = await applyTagAction({ shop: SHOP, contactEmail: "" }, { tagId: "x", tagAction: ADD });
  assert.equal(noEmail.ok, false);
});

// ── Publish validation ─────────────────────────────────────────────────────

test("a flow with a working tag node publishes", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Fine", nameKey: "fine" } });
  const j = await makeFlow(taggingFlow(tag.id));
  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, true, errors.map((e) => e.message).join(" | "));
});

test("a tag node with no tag chosen blocks publishing", async () => {
  const j = await makeFlow(taggingFlow(null));
  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /pick the tag/i.test(e.message)));
});

test("a deleted tag blocks publishing — the only place it is visible", async () => {
  // At send time a missing tag is a logged skip, by design. If publishing let
  // it through, the merchant would have a flow that runs perfectly and tags
  // nobody, with nothing anywhere saying so.
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Bye", nameKey: "bye" } });
  const j = await makeFlow(taggingFlow(tag.id));
  await prisma.tag.delete({ where: { id: tag.id } });

  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /has been deleted/.test(e.message)));
});

test("a tag on one arm of an A/B test warns without blocking", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "ArmA", nameKey: "arma" } });
  const j = await makeFlow([
    { kind: "trigger", id: TRIGGER_ID },
    { ...em("first"), id: "f", parentId: TRIGGER_ID, branch: NEXT },
    { kind: "split", id: "t", parentId: "f", branch: NEXT, emailName: "Test",
      splitMode: BY_CHANCE, splitWeight: 50, splitMetric: "click" },
    { kind: "tag", id: "tg", parentId: "t", branch: ARM_A, tagId: tag.id, tagAction: ADD },
    { kind: "exit", id: "ax", parentId: "tg", branch: NEXT },
    { ...em("b side"), id: "b", parentId: "t", branch: ARM_B },
    { kind: "exit", id: "bx", parentId: "b", branch: NEXT },
  ]);

  const { ok, warnings } = await validateFlowForPublish(j.id);
  assert.equal(ok, true, "tagging the winning arm is a legitimate thing to build");
  assert.ok(warnings.some((w) => /tags contacts and the other doesn't/.test(w.message)));
});

test("tags on both arms do not warn", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Both", nameKey: "both" } });
  const j = await makeFlow([
    { kind: "trigger", id: TRIGGER_ID },
    { ...em("first"), id: "f", parentId: TRIGGER_ID, branch: NEXT },
    { kind: "split", id: "t", parentId: "f", branch: NEXT, emailName: "Test",
      splitMode: BY_CHANCE, splitWeight: 50, splitMetric: "click" },
    { kind: "tag", id: "ta", parentId: "t", branch: ARM_A, tagId: tag.id, tagAction: ADD },
    { kind: "exit", id: "ax", parentId: "ta", branch: NEXT },
    { kind: "tag", id: "tb", parentId: "t", branch: ARM_B, tagId: tag.id, tagAction: ADD },
    { kind: "exit", id: "bx", parentId: "tb", branch: NEXT },
  ]);
  const { warnings } = await validateFlowForPublish(j.id);
  assert.ok(!warnings.some((w) => /tags contacts and the other/.test(w.message)));
});

// ── The timeline ───────────────────────────────────────────────────────────

test("the contact timeline says which flow applied a tag", async () => {
  const { buildTimeline } = await import("../contacts/timeline.server.js");
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Timeline", nameKey: "timeline" } });
  const contact = await makeContact("timeline@b.co");
  const j = await makeFlow(taggingFlow(tag.id));
  await runPastTag(j, "timeline@b.co");

  // Also apply one by hand, so both kinds appear on the same contact.
  const manual = await prisma.tag.create({ data: { shop: SHOP, name: "ByHand", nameKey: "byhand" } });
  await prisma.contactTag.create({ data: { contactId: contact.id, tagId: manual.id } });

  const events = (await buildTimeline(SHOP, "timeline@b.co")).filter((e) => e.kind === "tagged");
  const flowTag = events.find((e) => e.payload.tag === "Timeline");
  const handTag = events.find((e) => e.payload.tag === "ByHand");

  // The flow's NAME, read back from the journey — makeFlow happens to call
  // every flow "tagged", so this is asserted against the row rather than the
  // literal, or the test would pass for the wrong reason.
  const flow = await prisma.journey.findUnique({ where: { id: j.id }, select: { name: true } });
  assert.equal(flowTag.payload.byFlow, flow.name, "names the flow that applied it");
  // A hand-applied tag shows no source rather than a guessed one.
  assert.equal(handTag.payload.byFlow, null);
});

// ── Persistence ────────────────────────────────────────────────────────────

test("a tag node survives a save round trip", async () => {
  const tag = await prisma.tag.create({ data: { shop: SHOP, name: "Round", nameKey: "round" } });
  const j = await makeFlow(taggingFlow(tag.id, REMOVE));
  const step = await prisma.journeyStep.findFirst({ where: { journeyId: j.id, nodeType: "tag" } });
  assert.equal(step.tagId, tag.id);
  assert.equal(step.tagAction, REMOVE);
  assert.equal(step.emailName, "Mark as engaged");
});
