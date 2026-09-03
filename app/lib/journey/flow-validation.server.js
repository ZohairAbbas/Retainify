/**
 * Pre-publish validation.
 *
 * Publishing used to be an unconditional status flip, so a flow could go live
 * with an empty subject line, a push step with no body, a WhatsApp step with no
 * template, or a segment trigger bound to nothing. None of those fail loudly:
 * the worker either falls back to canned copy or marks the job done and moves
 * on, so the merchant sees a published flow that quietly sends nothing (or
 * sends the wrong thing).
 *
 * The rule for what belongs here: block only on conditions that make a step
 * un-sendable, and only for steps that are actually enabled. A disabled step is
 * a draft the merchant is parking — it must never stand between them and
 * publishing the rest of the flow.
 *
 * ── Structure is checked too ───────────────────────────────────────────────
 * Since flows became trees there is a second way to be broken that has nothing
 * to do with any one step: a branch that leads nowhere, a split that cannot
 * decide, two steps joined back together, a loop. validateGraph answers those
 * and this merges its findings in, so the merchant gets one list rather than
 * fixing a step, republishing, and being told about the shape.
 */
import prisma from "../../db.server.js";
import {
  loadGraph,
  validateGraph,
  branchesOf,
  branchLabel,
  nextStepId,
  walkFrom,
} from "./graph.server.js";
import { flowFieldsForSplit, validateSplitCondition } from "./split-conditions.server.js";

/**
 * @typedef {{ message: string, stepNumber?: number }} FlowIssue
 */

/**
 * @param {string} journeyId
 * @returns {Promise<{ ok: boolean, errors: FlowIssue[], warnings: FlowIssue[] }>}
 *          `ok` follows errors alone — warnings never block a publish.
 */
export async function validateFlowForPublish(journeyId) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: {
      steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" } },
    },
  });

  if (!journey) {
    return { ok: false, errors: [{ message: "This flow no longer exists." }], warnings: [] };
  }

  /** @type {FlowIssue[]} */
  const errors = [];
  /**
   * Things worth telling the merchant that must NOT stop them publishing.
   *
   * Distinct from errors on purpose: an error means the flow would misbehave,
   * a warning means it will do exactly what was asked and the result may be
   * harder to read. Conflating them would either block legitimate work or bury
   * a real fault in advice.
   *
   * @type {FlowIssue[]}
   */
  const warnings = [];

  const sendable = journey.steps.filter(
    (s) => ["email", "push", "whatsapp"].includes(s.nodeType) && s.isEnabled,
  );

  if (sendable.length === 0) {
    errors.push({
      message:
        "This flow has no enabled steps that send anything. Add an email, push or WhatsApp step before publishing.",
    });
  }

  // Trigger wiring. A segment-entry flow with no segment is inert: the
  // enrollment worker filters on triggerSegmentKey and skips it entirely.
  if (journey.trigger === "segment_entered" && !journey.triggerSegmentKey) {
    errors.push({ message: "Pick the segment that starts this flow." });
  }

  // ── Shape ────────────────────────────────────────────────────────────────
  const graph = await loadGraph(journeyId);
  errors.push(...validateGraph(graph).errors);

  const splits = [...graph.steps.values()].filter((s) => s.nodeType === "split");

  // A broadcast is one message to an audience already chosen at setup. A split
  // inside one is a second targeting mechanism, and a merchant looking at a
  // recipient would have no way to tell which of the two decided they got it.
  //
  // Enforced on the trigger rather than trusting the builder to hide the menu
  // item, so a flow switched to broadcast cannot carry a split in from
  // whatever it was before — the same guard entry filters need.
  if (journey.trigger === "broadcast" && splits.length) {
    errors.push({
      message:
        "This is a broadcast, so it can't contain a split. A broadcast sends one message to one audience — remove the split, or change the trigger.",
    });
  }

  // ── Concurrent tests ─────────────────────────────────────────────────────
  // Two A/B tests running at once confound each other: the second test's arms
  // are populated unevenly by the first, so neither result is clean. Worth
  // saying plainly — but a warning, not a block, because nested tests are
  // legitimate at volume and a hard rule would just be worked around by
  // duplicating the flow.
  const tests = splits.filter((s) => s.splitMode === "random");
  if (tests.length > 1) {
    warnings.push({
      message:
        `This flow has ${tests.length} A/B tests running at once. Their results will overlap — ` +
        `each test divides an audience the other has already divided — so treat the numbers as rough ` +
        `until only one is running.`,
    });
  }

  // ── Tag nodes ────────────────────────────────────────────────────────────
  // A tag node whose tag has been deleted does nothing at all — the apply
  // fails, the walk continues, and the merchant sees a flow that runs
  // perfectly while quietly not tagging anyone. The only place to catch that
  // is here.
  const tagSteps = [...graph.steps.values()].filter((s) => s.nodeType === "tag");
  if (tagSteps.length) {
    const referenced = tagSteps.map((s) => s.tagId).filter(Boolean);
    const live = new Set(
      referenced.length
        ? (
            await prisma.tag.findMany({
              where: { id: { in: referenced }, shop: journey.shop },
              select: { id: true },
            })
          ).map((t) => t.id)
        : [],
    );
    for (const step of tagSteps) {
      if (!step.tagId) {
        errors.push({
          stepNumber: step.stepNumber,
          message: `Step ${step.stepNumber}: pick the tag this step should ${step.tagAction === "remove" ? "remove" : "add"}.`,
        });
      } else if (!live.has(step.tagId)) {
        errors.push({
          stepNumber: step.stepNumber,
          message: `Step ${step.stepNumber}: the tag this step used has been deleted. Pick another.`,
        });
      }
    }

    // A tag inside one arm of an A/B test means the arms differ in a side
    // effect as well as their messages, so the result measures both together.
    // A warning rather than a block: tagging the people who took the winning
    // arm is a perfectly reasonable thing to build.
    for (const test of tests) {
      const armsWithTags = branchesOf(test)
        .map((arm) => {
          const root = nextStepId(graph, test.id, arm);
          const reached = root ? walkFrom(graph, root) : [];
          return reached.some((id) => graph.steps.get(id)?.nodeType === "tag") ? arm : null;
        })
        .filter(Boolean);
      if (armsWithTags.length === 1) {
        warnings.push({
          stepNumber: test.stepNumber,
          message:
            `Step ${test.stepNumber}: variant ${branchLabel(armsWithTags[0])} tags contacts and the other doesn't. ` +
            `The test will measure that difference along with the messages.`,
        });
      }
    }
  }

  // Each split's condition, checked against the steps actually above it. A
  // rule naming a step that has since been moved below the split, or onto the
  // other branch, can never be true — so the split would silently send its
  // whole audience down No.
  for (const split of splits) {
    // An empty condition is validateGraph's to report — it says it better, and
    // two errors about the same missing thing reads as two problems.
    if (!split.splitCondition) continue;
    const allowed = new Set(flowFieldsForSplit(graph, split.id).map((f) => f.id));
    for (const problem of validateSplitCondition(split.splitCondition, allowed)) {
      errors.push({ stepNumber: split.stepNumber, message: `Step ${split.stepNumber}: ${problem}` });
    }
  }

  // WhatsApp needs a live channel, and the templates must be ones Meta approved
  // for THIS shop — a name that doesn't resolve is rejected at send time with an
  // opaque provider error.
  const usesWhatsapp = sendable.some((s) => s.nodeType === "whatsapp");
  let approvedTemplates = new Set();
  if (usesWhatsapp) {
    const [account, settings, templates] = await Promise.all([
      prisma.whatsappAccount.findUnique({ where: { shop: journey.shop } }),
      prisma.shopSettings.findUnique({ where: { shop: journey.shop } }),
      prisma.whatsappTemplate.findMany({
        where: { shop: journey.shop, status: "APPROVED" },
        select: { name: true },
      }),
    ]);
    approvedTemplates = new Set(templates.map((t) => t.name));

    if (!account || account.status !== "connected") {
      errors.push({
        message:
          "This flow sends on WhatsApp, but no WhatsApp Business account is connected. Connect one in WhatsApp settings first.",
      });
    } else if (!settings?.whatsappEnabled) {
      errors.push({
        message:
          "This flow sends on WhatsApp, but the WhatsApp channel is switched off. Turn it on in WhatsApp settings first.",
      });
    }
  }

  for (const step of sendable) {
    const at = step.stepNumber;

    if (step.nodeType === "email") {
      if (!String(step.subject || "").trim()) {
        errors.push({ stepNumber: at, message: `Step ${at}: the email needs a subject line.` });
      }
      if (step.emailMode === "html" && !String(step.emailHtml || "").trim()) {
        errors.push({
          stepNumber: at,
          message: `Step ${at}: this email is set to Custom HTML but nothing has been pasted in.`,
        });
      }
    }

    if (step.nodeType === "push") {
      if (!String(step.pushTitle || "").trim()) {
        errors.push({ stepNumber: at, message: `Step ${at}: the push notification needs a title.` });
      }
      if (!String(step.pushBody || "").trim()) {
        errors.push({ stepNumber: at, message: `Step ${at}: the push notification needs body text.` });
      }
    }

    if (step.nodeType === "whatsapp") {
      const name = String(step.waTemplateName || "").trim();
      if (!name) {
        errors.push({ stepNumber: at, message: `Step ${at}: pick an approved WhatsApp template.` });
      } else if (approvedTemplates.size && !approvedTemplates.has(name)) {
        errors.push({
          stepNumber: at,
          message: `Step ${at}: the WhatsApp template "${name}" is no longer approved. Re-sync templates and pick another.`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
