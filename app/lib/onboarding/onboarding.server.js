import prisma from "../../db.server.js";
import { TASKS, ESSENTIAL_IDS, MANUAL_IDS } from "./tasks.js";

/**
 * Compute the full onboarding/setup state for a shop.
 *
 * Two kinds of tasks:
 *  - auto-detected (sender/popup/flow): derived from real data every read, so the
 *    checklist self-heals when the merchant configures things on other pages.
 *  - manual (store/embed/call): there is no reliable signal, so completion is
 *    stored in ShopSettings.onboardingProgress { done, skipped }.
 *
 * Skips are always honored from the stored JSON (any task can be skipped).
 */
export async function getOnboardingState(shop) {
  const [settings, popup, journeyCount] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.popupSettings.findUnique({ where: { shop } }),
    prisma.journey.count({ where: { shop, archivedAt: null } }),
  ]);

  const progress = normalizeProgress(settings?.onboardingProgress);

  // Auto-detected signals.
  const auto = {
    sender: !!settings?.senderEmail && settings.senderEmail.trim().length > 0,
    popup: !!popup?.enabled,
    flow: journeyCount > 0,
  };

  const done = {};
  const skipped = {};
  for (const t of TASKS) {
    // A task is done if auto-detected true OR manually marked done. Skips only
    // count when the task isn't actually done.
    const isDone =
      (t.id in auto ? auto[t.id] : false) || progress.done[t.id] === true;
    done[t.id] = isDone;
    skipped[t.id] = !isDone && progress.skipped[t.id] === true;
  }

  const essentialsDone = ESSENTIAL_IDS.every((id) => done[id]);
  // Setup is "complete" (clears banner + nav) when every task is resolved:
  // done OR skipped. Essentials can't be skipped, so they must be done.
  const setupComplete = TASKS.every((t) => done[t.id] || skipped[t.id]);

  return {
    settings: settings ?? null,
    done,
    skipped,
    essentialsDone,
    setupComplete,
    // Convenience for the pre-activation gate.
    activated: !!settings?.isActive && (settings?.onboardingStep ?? 0) >= 2,
  };
}

/** Coerce a possibly-null/garbage JSON value into { done, skipped } maps. */
export function normalizeProgress(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const done = src.done && typeof src.done === "object" ? src.done : {};
  const skipped = src.skipped && typeof src.skipped === "object" ? src.skipped : {};
  return { done: { ...done }, skipped: { ...skipped } };
}

/**
 * Persist a manual task transition (complete or skip) into onboardingProgress.
 * Auto-detected tasks ignore "complete" writes (their truth is real data) but
 * may still be skipped.
 */
export async function setTaskState(shop, taskId, transition) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const progress = normalizeProgress(settings?.onboardingProgress);

  if (transition === "complete") {
    if (MANUAL_IDS.includes(taskId)) progress.done[taskId] = true;
    delete progress.skipped[taskId];
  } else if (transition === "skip") {
    progress.skipped[taskId] = true;
    delete progress.done[taskId];
  } else if (transition === "reset") {
    delete progress.done[taskId];
    delete progress.skipped[taskId];
  }

  await prisma.shopSettings.upsert({
    where: { shop },
    create: { shop, onboardingProgress: progress },
    update: { onboardingProgress: progress },
  });

  return progress;
}
