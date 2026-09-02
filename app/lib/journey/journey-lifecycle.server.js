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

/**
 * Publish a flow.
 *
 * For `segment_entered` flows this also pins a baseline against the trigger
 * segment (see seedSegmentBaselineForFlow). `backfillSegmentMembers` opts in
 * to enrolling the contacts already in that segment at publish time — off by
 * default, because the trigger means "enters the segment" and auto-enrolling
 * a large segment would blast every member with no undo.
 *
 * Re-publishing an already-published flow (saving changes) never backfills:
 * the baseline is already pinned and enrollContact's entryFrequency rules
 * would mostly dedupe anyway, but silently re-enrolling on every save would
 * be a nasty surprise.
 */
export async function publishJourney(journeyId, { backfillSegmentMembers = false } = {}) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) return null;

  const wasPublished = journey.status === "published";

  const updated = await prisma.journey.update({
    where: { id: journeyId },
    data: {
      status: "published",
      isActive: true,
      publishedAt: new Date(),
      publishedVersion: journey.publishedVersion + 1,
    },
  });

  let segmentBaseline = null;
  if (!wasPublished && updated.trigger === "segment_entered" && updated.triggerSegmentKey) {
    try {
      // Imported lazily: the segment worker pulls in the evaluator, which is a
      // heavy dependency for a module every flow route touches.
      const { seedSegmentBaselineForFlow } = await import(
        "../segments/segmentEnrollmentWorker.server.js"
      );
      segmentBaseline = await seedSegmentBaselineForFlow(updated, {
        enrollExisting: backfillSegmentMembers,
      });
    } catch (e) {
      console.error(`[flow-lifecycle] segment baseline for ${journeyId} failed:`, e);
    }
  }

  // segmentBaseline is surfaced to the merchant as a post-publish toast, so
  // "enrolled 0 of N" is visible rather than only landing in the server log.
  return { ...updated, segmentBaseline };
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
 *   emailName, templateStyle, discountPct, isEnabled, stepKey }.
 *
 * ── stepKey ────────────────────────────────────────────────────────────────
 * Every step here is deleted and recreated, so JourneyStep.id is not an
 * identity — it changes on every save, and the reports lose whatever they
 * keyed on it. `stepKey` is the identity that survives: the canvas sends back
 * the key it loaded, and a step the merchant just added has none, so Prisma's
 * default mints one. Never generate a key for a step that arrived with one, or
 * that step silently detaches from its own send history.
 */
export async function saveDraft(journeyId, { name, entryFrequency, exitCriteria, entryFilters, steps, triggerSegmentKey, trigger }) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) return null;

  // ── delayHours is raw, not cumulative ──────────────────────────────────
  // This used to accumulate the Wait nodes above each sendable step and write
  // the running total onto it, so a send step carried "hours since the
  // trigger". The eager scheduler read that number directly to set an absolute
  // scheduledFor at enrollment.
  //
  // Neither half survives branching. A cumulative figure is a property of a
  // PATH, not of a step — on a tree it is right for one branch and wrong for
  // the other — and the lazy scheduler never wants it anyway, because it
  // serves each Wait as it reaches it, measured from the previous step
  // settling. So a Wait stores what it waits for, a send stores nothing, and
  // anything that wants "how far into the flow is this" computes it from the
  // graph (delayFromRoot).
  //
  // Safe for the eager enrollments still in flight: their jobs already hold an
  // absolute scheduledFor and nothing re-reads delayHours to reschedule them.
  //
  // Steps are numbered in the order they arrive, which is the order the canvas
  // lays them out — depth-first, Yes branch before No, once it can produce a
  // tree. That keeps "a lower number is upstream" true along any single path,
  // which is what the eager sequence gate assumes.
  const rows = [];
  let positionY = 0;
  for (const s of steps || []) {
    // Present for a step that already existed, absent for one the merchant just
    // dropped on the canvas. Spread rather than assigned, so "absent" reaches
    // Prisma as absent and its @default(cuid()) mints a fresh key — writing
    // `stepKey: s.stepKey` would send null and fail the NOT NULL column.
    const keepKey = s.stepKey ? { stepKey: s.stepKey } : {};
    if (s.nodeType === "delay") {
      rows.push({
        ...keepKey,
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
        ...keepKey,
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
        ...keepKey,
        nodeType: "push",
        delayHours: 0,
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
    } else if (s.nodeType === "whatsapp") {
      rows.push({
        ...keepKey,
        nodeType: "whatsapp",
        delayHours: 0,
        positionY: positionY++,
        stepNumber: positionY,
        subject: "",
        previewText: "",
        emailName: "",
        templateStyle: "classic",
        discountPct: 0,
        isEnabled: s.isEnabled !== false,
        waTemplateName: s.waTemplateName || "",
        waLanguage: s.waLanguage || "",
        // Prisma Json column — store the object directly (no stringify).
        waVariables: s.waVariables || {},
        waMediaUrl: s.waMediaUrl || "",
      });
    } else {
      const emailBlocks = isEmptyBlocks(s.emailBlocks)
        ? defaultEmailBlocks(s.subject)
        : s.emailBlocks;
      rows.push({
        ...keepKey,
        nodeType: "email",
        delayHours: 0,
        positionY: positionY++,
        stepNumber: positionY,
        subject: s.subject || "",
        previewText: s.previewText || "",
        emailName: s.emailName || "",
        templateStyle: s.templateStyle || "classic",
        discountPct: Number(s.discountPct) || 0,
        isEnabled: s.isEnabled !== false,
        emailMode: s.emailMode === "html" ? "html" : "blocks",
        emailHtml: s.emailHtml || "",
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
      OR: [{ jobs: { some: {} } }, { pushJobs: { some: {} } }, { whatsappJobs: { some: {} } }],
    },
    select: { id: true },
  });
  const archiveIds = stepsWithJobs.map((s) => s.id);

  // Interactive rather than the array form, because the edges below need the
  // ids of the steps created two statements earlier. Same statements, same
  // order, same atomicity — a save that fails partway must not leave a flow
  // with steps but no graph.
  await prisma.$transaction(async (tx) => {
    await tx.journeyStep.deleteMany({
      where: { journeyId, isArchived: false, id: { notIn: archiveIds } },
    });
    await tx.journeyStep.updateMany({
      where: { id: { in: archiveIds } },
      data: { isArchived: true },
    });
    await tx.journeyStep.createMany({
      data: rows.map((r) => ({ journeyId, ...r })),
    });

    // ── Rebuild the step graph ───────────────────────────────────────────
    // Every live step was just deleted and recreated with a new id, so the
    // existing edges point at rows that no longer exist. JourneyEdge cascades
    // on Journey, not on JourneyStep — deliberately, since a step can be
    // archived rather than deleted — which means nothing cleans these up for
    // us and a stale edge would outlive its step silently.
    //
    // Phase 1 writes the same straight line the flow already is; the canvas
    // has no way to express a branch yet. What matters here is that the graph
    // is rebuilt on every save from the moment the column exists, so it is
    // never out of step with the rows it describes.
    await tx.journeyEdge.deleteMany({ where: { journeyId } });

    const live = await tx.journeyStep.findMany({
      where: { journeyId, isArchived: false },
      orderBy: [{ stepNumber: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (live.length > 1) {
      await tx.journeyEdge.createMany({
        data: live.slice(0, -1).map((s, i) => ({
          journeyId,
          fromStepId: s.id,
          toStepId: live[i + 1].id,
          branch: "next",
        })),
      });
    }

    await tx.journey.update({
      where: { id: journeyId },
      data: {
        name: name ?? journey.name,
        entryFrequency: entryFrequency ?? journey.entryFrequency,
        exitCriteria: exitCriteria ? JSON.stringify(exitCriteria) : journey.exitCriteria,
        // Entry conditions. undefined leaves them alone; null clears them.
        // Unlike the fields above there is no "falsy means unchanged" here —
        // clearing every filter has to be savable, and an empty tree is falsy.
        ...(entryFilters !== undefined ? { entryFilters } : {}),
        // Allow rebinding a segment-trigger flow to a different segment from
        // the inspector. Pass undefined to leave it alone; null clears it.
        ...(triggerSegmentKey !== undefined ? {
          triggerSegmentKey,
          // Force one fresh enrollment pass with the new key.
          lastEnrollmentHash: null,
        } : {}),
        // Allow changing the trigger itself from the inspector. When
        // switching away from segment_entered, also wipe the segment key
        // so we don't keep a dangling reference.
        ...(trigger !== undefined ? {
          trigger,
          ...(trigger !== "segment_entered" ? { triggerSegmentKey: null } : {}),
          lastEnrollmentHash: null,
        } : {}),
        draftVersion: journey.draftVersion + 1,
      },
    });
  });

  return prisma.journey.findUnique({
    where: { id: journeyId },
    include: { steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" } } },
  });
}
