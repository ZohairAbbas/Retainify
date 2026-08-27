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
 */
import prisma from "../../db.server.js";

/**
 * @typedef {{ message: string, stepNumber?: number }} FlowIssue
 */

/**
 * @param {string} journeyId
 * @returns {Promise<{ ok: boolean, errors: FlowIssue[] }>}
 */
export async function validateFlowForPublish(journeyId) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: {
      steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" } },
    },
  });

  if (!journey) return { ok: false, errors: [{ message: "This flow no longer exists." }] };

  /** @type {FlowIssue[]} */
  const errors = [];

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

  return { ok: errors.length === 0, errors };
}
