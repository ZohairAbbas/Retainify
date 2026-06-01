/**
 * Flow lifecycle: draft / publish / pause / archive.
 *
 * Draft journeys are editable but do NOT enroll contacts.
 * Published journeys are live — workers pick up new enrollments.
 * Paused journeys keep in-flight jobs running but block new enrollments.
 */
import prisma from "../../db.server.js";

// Default email blocks for steps the merchant never opened in the visual
// editor. The journey worker always calls renderVisualEmail(), so we seed a
// safe minimum here rather than depend on a legacy fallback at send time.
// Merge tags are resolved by the renderer.
function defaultEmailBlocks(subject) {
  const bid = () => "b_" + Math.random().toString(36).slice(2, 7);
  return JSON.stringify([
    { id: bid(), type: "logo", text: "{store_name}", align: "center", size: "medium" },
    { id: bid(), type: "heading", html: subject || "A message from {store_name}", level: 1, align: "left" },
    { id: bid(), type: "paragraph", html: "Hi {first_name}, thanks for shopping with us.", align: "left" },
    { id: bid(), type: "footer", storeName: "{store_name}", address: "", unsubscribe: true },
  ]);
}

function isEmptyBlocks(raw) {
  if (raw == null) return true;
  try {
    const parsed = JSON.parse(raw);
    return !Array.isArray(parsed) || parsed.length === 0;
  } catch {
    return true;
  }
}

export async function publishJourney(journeyId) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) return null;

  return prisma.journey.update({
    where: { id: journeyId },
    data: {
      status: "published",
      isActive: true,
      publishedAt: new Date(),
      publishedVersion: journey.publishedVersion + 1,
    },
  });
}

export async function pauseJourney(journeyId) {
  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: "paused", isActive: false },
  });
}

export async function unpublishToDraft(journeyId) {
  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: "draft", isActive: false },
  });
}

export async function archiveJourney(journeyId) {
  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: "paused", isActive: false, archivedAt: new Date() },
  });
}

/**
 * Save canvas draft: replace all steps in a transaction, bump draftVersion.
 * `steps` is an array of { stepNumber, nodeType, delayHours, subject, previewText,
 *   emailName, templateStyle, discountPct, isEnabled }.
 */
export async function saveDraft(journeyId, { name, entryFrequency, exitCriteria, steps }) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) return null;

  // Accumulate delay-from-trigger across delay nodes so each email step
  // gets the correct cumulative `delayHours` (matches Phase 2 worker semantics).
  let cumulativeHours = 0;
  const rows = [];
  let positionY = 0;
  for (const s of steps || []) {
    if (s.nodeType === "delay") {
      cumulativeHours += Number(s.delayHours) || 0;
      rows.push({
        nodeType: "delay",
        delayHours: Number(s.delayHours) || 0,
        positionY: positionY++,
        stepNumber: positionY,
        subject: "",
        previewText: "",
        emailName: "",
        templateStyle: "classic",
        discountPct: 0,
        isEnabled: true,
      });
    } else if (s.nodeType === "exit") {
      rows.push({
        nodeType: "exit",
        delayHours: 0,
        positionY: positionY++,
        stepNumber: positionY,
        subject: "",
        previewText: "",
        emailName: "",
        templateStyle: "classic",
        discountPct: 0,
        isEnabled: true,
      });
    } else if (s.nodeType === "push") {
      rows.push({
        nodeType: "push",
        delayHours: cumulativeHours,
        positionY: positionY++,
        stepNumber: positionY,
        subject: "",
        previewText: "",
        emailName: "",
        templateStyle: "classic",
        discountPct: 0,
        isEnabled: s.isEnabled !== false,
        pushTitle: s.pushTitle || "",
        pushBody: s.pushBody || "",
        pushIconUrl: s.pushIconUrl || "",
        pushClickUrl: s.pushClickUrl || "",
      });
    } else {
      const emailBlocks = isEmptyBlocks(s.emailBlocks)
        ? defaultEmailBlocks(s.subject)
        : s.emailBlocks;
      rows.push({
        nodeType: "email",
        delayHours: cumulativeHours,
        positionY: positionY++,
        stepNumber: positionY,
        subject: s.subject || "",
        previewText: s.previewText || "",
        emailName: s.emailName || "",
        templateStyle: s.templateStyle || "classic",
        discountPct: Number(s.discountPct) || 0,
        isEnabled: s.isEnabled !== false,
        emailBlocks,
        emailBrand: s.emailBrand || "{}",
      });
    }
  }

  // JourneyJob AND PushJob both cascade on JourneyStep delete, so blindly
  // wiping every step would silently kill in-flight emails for contacts
  // already enrolled AND erase historical push send records. Steps still
  // referenced by *either* relation are *archived* instead of deleted — kept
  // so their jobs survive, but hidden from the builder canvas and step counts
  // (all reads filter isArchived: false). Steps with no jobs are safe to
  // delete outright.
  const stepsWithJobs = await prisma.journeyStep.findMany({
    where: {
      journeyId,
      isArchived: false,
      OR: [{ jobs: { some: {} } }, { pushJobs: { some: {} } }],
    },
    select: { id: true },
  });
  const archiveIds = stepsWithJobs.map((s) => s.id);

  await prisma.$transaction([
    prisma.journeyStep.deleteMany({
      where: { journeyId, isArchived: false, id: { notIn: archiveIds } },
    }),
    prisma.journeyStep.updateMany({
      where: { id: { in: archiveIds } },
      data: { isArchived: true },
    }),
    prisma.journeyStep.createMany({
      data: rows.map((r) => ({ journeyId, ...r })),
    }),
    prisma.journey.update({
      where: { id: journeyId },
      data: {
        name: name ?? journey.name,
        entryFrequency: entryFrequency ?? journey.entryFrequency,
        exitCriteria: exitCriteria ? JSON.stringify(exitCriteria) : journey.exitCriteria,
        draftVersion: journey.draftVersion + 1,
      },
    }),
  ]);

  return prisma.journey.findUnique({
    where: { id: journeyId },
    include: { steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" } } },
  });
}
