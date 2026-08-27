import prisma from "../../db.server.js";
import { MANUAL_IDS, essentialIdsFor, tasksFor } from "./tasks.js";

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
  const [settings, popup, journeyCount, account, contactCount] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.popupSettings.findUnique({ where: { shop } }),
    prisma.journey.count({ where: { shop, archivedAt: null } }),
    prisma.account.findUnique({ where: { key: shop }, select: { kind: true } }),
    prisma.contact.count({ where: { shop } }),
  ]);

  // Which checklist this workspace gets. An account row is created on the first
  // authenticated request, so its absence means a Shopify install that predates
  // the tenancy tables — the old behaviour is the right default there.
  const kind = account?.kind === "direct" ? "direct" : "shopify";
  const tasks = tasksFor(kind);

  const progress = normalizeProgress(settings?.onboardingProgress);

  // Auto-detected signals. Sender email is not merchant-editable (all sends use
  // our shared from-address), so the sender step completes once the merchant has
  // set a real sender NAME — the only field they actually fill in.
  const senderName = (settings?.senderName || "").trim();
  const auto = {
    sender: senderName.length > 0 && senderName !== "Your Store",
    // Optional custom-domain step completes once the domain is verified. It's
    // skippable, so an unverified/absent domain never blocks activation.
    domain: !!settings?.domainVerified,
    popup: !!popup?.enabled,
    flow: journeyCount > 0,
    // Direct workspaces have no storefront capture, so the list has to come
    // from somewhere — an import or a manual add. Either way, contacts exist.
    contacts: contactCount > 0,
  };

  const done = {};
  const skipped = {};
  for (const t of tasks) {
    // A task is done if auto-detected true OR manually marked done. Skips only
    // count when the task isn't actually done.
    const isDone =
      (t.id in auto ? auto[t.id] : false) || progress.done[t.id] === true;
    done[t.id] = isDone;
    skipped[t.id] = !isDone && progress.skipped[t.id] === true;
  }

  const essentialsDone = essentialIdsFor(kind).every((id) => done[id]);
  // Setup is "complete" (clears banner + nav) when every task is resolved:
  // done OR skipped. Essentials can't be skipped, so they must be done.
  const setupComplete = tasks.every((t) => done[t.id] || skipped[t.id]);

  return {
    settings: settings ?? null,
    kind,
    tasks,
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
    // Auto-detected tasks derive their truth from real data, so a "complete"
    // write here cannot make them done. Recording it as a SKIP is what the
    // merchant actually meant by "mark as done": stop asking me about this.
    //
    // Previously this branch dropped the write for auto tasks and cleared any
    // existing skip, so the task collapsed in the UI and then reappeared on the
    // next load — while the panel's own comment claimed panels never fake
    // progress.
    if (MANUAL_IDS.includes(taskId)) {
      progress.done[taskId] = true;
      delete progress.skipped[taskId];
    } else {
      progress.skipped[taskId] = true;
    }
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
