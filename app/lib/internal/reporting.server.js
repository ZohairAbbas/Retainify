/**
 * Read-only reporting on the internal workspace, for Merchant360.
 *
 * Merchant360 shows per-store lifecycle analytics — "which of my merchants got
 * the onboarding flow, did they open it, did they then connect a courier" —
 * and it knows merchants, stores and outcomes, while Retainify knows
 * enrollments and message engagement. These functions hand over the Retainify
 * half, keyed by email, and Merchant360 joins it to stores.
 *
 * Scoped to the internal tenant in every query. This is deliberately an API
 * rather than a database link: a postgres_fdw attachment would give
 * Merchant360 every merchant's buyer data along with our own.
 *
 * Also here: Merchant360-managed segments. A segment built in Merchant360 is
 * delivered as a tag ("m360:seg:<key>") on each member contact by the contact
 * sync; ensureManagedSegments makes a matching dynamic segment exist in the
 * internal workspace so it shows up in campaign audiences and segment
 * triggers without anyone recreating it by hand.
 */
import prisma from "../../db.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

const MAX_PAGE = 5000;

/** Every internal flow with headline numbers. */
export async function listInternalFlows() {
  const flows = await prisma.journey.findMany({
    where: { shop: INTERNAL_SHOP, archivedAt: null, trigger: { not: "broadcast" } },
    select: {
      id: true, name: true, trigger: true, triggerApp: true, triggerEvent: true,
      triggerSegmentKey: true, status: true, publishedAt: true, createdAt: true, updatedAt: true,
      steps: { where: { isArchived: false }, select: { nodeType: true, isEnabled: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const broadcasts = await prisma.journey.findMany({
    where: { shop: INTERNAL_SHOP, archivedAt: null, trigger: "broadcast" },
    select: { id: true, name: true, trigger: true, status: true, publishedAt: true, createdAt: true, updatedAt: true,
      steps: { where: { isArchived: false }, select: { nodeType: true, isEnabled: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const all = [...flows, ...broadcasts];
  const ids = all.map((f) => f.id);
  const counts = ids.length
    ? await prisma.journeyEnrollment.groupBy({
        by: ["journeyId"], where: { journeyId: { in: ids } }, _count: { _all: true },
      })
    : [];
  const byId = new Map(counts.map((c) => [c.journeyId, c._count._all]));

  const segIds = [...new Set(flows.map((f) => f.triggerSegmentKey).filter(Boolean))];
  const segs = segIds.length
    ? await prisma.segment.findMany({ where: { id: { in: segIds }, shop: INTERNAL_SHOP }, select: { id: true, name: true } })
    : [];
  const segName = new Map(segs.map((s) => [s.id, s.name]));

  return all.map((f) => ({
    id: f.id,
    name: f.name,
    kind: f.trigger === "broadcast" ? "campaign" : "flow",
    trigger: f.trigger,
    triggerApp: f.triggerApp,
    triggerEvent: f.triggerEvent,
    triggerSegment: f.triggerSegmentKey ? segName.get(f.triggerSegmentKey) || f.triggerSegmentKey : null,
    status: f.status,
    publishedAt: f.publishedAt,
    createdAt: f.createdAt,
    channels: [...new Set(f.steps.filter((s) => s.isEnabled !== false && ["email", "whatsapp", "push"].includes(s.nodeType)).map((s) => s.nodeType))],
    enrollments: byId.get(f.id) || 0,
  }));
}

/**
 * Per-message stats for a set of enrollments, one entry per enrollment id.
 * Counts, plus the first open/click/read, which is what "did it work" asks.
 */
async function engagementFor(enrollmentIds) {
  const out = new Map();
  if (!enrollmentIds.length) return out;
  const blank = () => ({
    emailStats: { sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0, pending: 0, firstOpenedAt: null, firstClickedAt: null, lastSentAt: null },
    whatsappStats: { sent: 0, delivered: 0, read: 0, replied: 0, clicked: 0, failed: 0, pending: 0, firstReadAt: null, lastSentAt: null },
  });
  const min = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  const max = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

  const [emailJobs, waJobs] = await Promise.all([
    prisma.journeyJob.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      select: { enrollmentId: true, status: true, sentAt: true, deliveredAt: true, openedAt: true, clickedAt: true, failedAt: true },
    }),
    prisma.whatsappJob.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      select: { enrollmentId: true, status: true, sentAt: true, deliveredAt: true, readAt: true, repliedAt: true, clickedAt: true, failedAt: true },
    }),
  ]);
  for (const j of emailJobs) {
    const s = (out.get(j.enrollmentId) || out.set(j.enrollmentId, blank()).get(j.enrollmentId)).emailStats;
    if (j.sentAt) s.sent += 1;
    if (j.deliveredAt) s.delivered += 1;
    if (j.openedAt) s.opened += 1;
    if (j.clickedAt) s.clicked += 1;
    if (j.status === "failed" || j.failedAt) s.failed += 1;
    if (j.status === "pending" || j.status === "processing") s.pending += 1;
    s.firstOpenedAt = min(s.firstOpenedAt, j.openedAt);
    s.firstClickedAt = min(s.firstClickedAt, j.clickedAt);
    s.lastSentAt = max(s.lastSentAt, j.sentAt);
  }
  for (const j of waJobs) {
    const s = (out.get(j.enrollmentId) || out.set(j.enrollmentId, blank()).get(j.enrollmentId)).whatsappStats;
    if (j.sentAt) s.sent += 1;
    if (j.deliveredAt) s.delivered += 1;
    if (j.readAt) s.read += 1;
    if (j.repliedAt) s.replied += 1;
    if (j.clickedAt) s.clicked += 1;
    if (j.status === "failed" || j.failedAt) s.failed += 1;
    if (j.status === "pending" || j.status === "processing") s.pending += 1;
    s.firstReadAt = min(s.firstReadAt, j.readAt);
    s.lastSentAt = max(s.lastSentAt, j.sentAt);
  }
  for (const id of enrollmentIds) if (!out.has(id)) out.set(id, blank());
  return out;
}

function enrollmentRow(e, stats) {
  let payloadData = {};
  try {
    payloadData = JSON.parse(e.payload || "{}")?.data || {};
  } catch {
    payloadData = {};
  }
  return {
    enrollmentId: e.id,
    flowId: e.journeyId,
    email: e.contactEmail,
    enrolledAt: e.enrolledAt,
    completedAt: e.completedAt,
    exitReason: e.exitReason || null,
    state: e.exitReason ? "exited" : e.completedAt ? "completed" : "active",
    shopDomain: typeof payloadData.shop_domain === "string" ? payloadData.shop_domain : null,
    ...stats.get(e.id),
  };
}

/**
 * One flow's enrollments with engagement, newest first, paged by cursor
 * (the last enrollment id of the previous page).
 */
export async function flowEnrollments(flowId, { since = null, cursor = null, limit = 1000 } = {}) {
  const flow = await prisma.journey.findFirst({ where: { id: flowId, shop: INTERNAL_SHOP }, select: { id: true, name: true } });
  if (!flow) return null;
  const take = Math.min(Math.max(1, limit), MAX_PAGE);
  const rows = await prisma.journeyEnrollment.findMany({
    where: { journeyId: flowId, shop: INTERNAL_SHOP, ...(since ? { enrolledAt: { gte: since } } : {}) },
    select: { id: true, journeyId: true, contactEmail: true, enrolledAt: true, completedAt: true, exitReason: true, payload: true },
    orderBy: [{ enrolledAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  const stats = await engagementFor(page.map((e) => e.id));
  return {
    flow,
    enrollments: page.map((e) => enrollmentRow(e, stats)),
    nextCursor: rows.length > take ? page[page.length - 1].id : null,
  };
}

/** Every flow one person has been in, with engagement — the store page view. */
export async function contactActivity(email) {
  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: INTERNAL_SHOP, email } },
    select: { email: true, subscriptionStatus: true, whatsappStatus: true, phone: true, customProps: true, deletedAt: true,
      tags: { select: { tag: { select: { name: true } } } } },
  });
  const enrollments = await prisma.journeyEnrollment.findMany({
    where: { shop: INTERNAL_SHOP, contactEmail: email },
    select: { id: true, journeyId: true, contactEmail: true, enrolledAt: true, completedAt: true, exitReason: true, payload: true,
      journey: { select: { name: true, trigger: true, triggerApp: true, triggerEvent: true } } },
    orderBy: { enrolledAt: "desc" },
    take: 200,
  });
  const stats = await engagementFor(enrollments.map((e) => e.id));
  return {
    contact: contact
      ? { ...contact, tags: contact.tags.map((t) => t.tag.name) }
      : null,
    enrollments: enrollments.map((e) => ({
      ...enrollmentRow(e, stats),
      flowName: e.journey.name,
      kind: e.journey.trigger === "broadcast" ? "campaign" : "flow",
      trigger: e.journey.triggerApp ? `${e.journey.triggerApp}/${e.journey.triggerEvent}` : e.journey.trigger,
    })),
  };
}

// ── Merchant360-managed segments ─────────────────────────────────────────

export const MANAGED_TAG_PREFIX = "m360:seg:";
const SEGMENT_KEY_RE = /^[a-z0-9_-]{1,48}$/;

/** Is this segment one ensureManagedSegments created? One hasTag rule on an m360:seg: tag. */
function managedTagId(segment) {
  const t = segment.filterTree;
  const kids = t?.children;
  if (!t || t.type !== "group" || !Array.isArray(kids) || kids.length !== 1) return null;
  const r = kids[0];
  return r?.type === "rule" && r.field === "hasTag" && r.op === "has" ? r.value : null;
}

/**
 * Make the internal workspace's managed segments match Merchant360's list.
 *
 * Each becomes a dynamic segment "M360 · <name>" whose one rule is "has tag
 * m360:seg:<key>", so its members are exactly the contacts the sync tagged.
 * With `prune`, managed segments whose key is no longer listed are soft-
 * deleted; segments people built are never touched.
 *
 * @param {Array<{ key: string, name: string, description?: string }>} segments
 */
export async function ensureManagedSegments(segments, { prune = false } = {}) {
  for (const s of segments) {
    if (!SEGMENT_KEY_RE.test(String(s.key || ""))) {
      return { ok: false, error: `Segment key "${s.key}" must be 1-48 lowercase letters, numbers, dashes or underscores.` };
    }
    if (!String(s.name || "").trim()) return { ok: false, error: `Segment "${s.key}" needs a name.` };
  }

  const existing = await prisma.segment.findMany({ where: { shop: INTERNAL_SHOP, deletedAt: null } });
  const managed = new Map();
  const tagIds = [...new Set(existing.map(managedTagId).filter(Boolean))];
  const tags = tagIds.length
    ? await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, nameKey: true } })
    : [];
  const tagKey = new Map(tags.map((t) => [t.id, t.nameKey]));
  for (const seg of existing) {
    const nk = tagKey.get(managedTagId(seg));
    if (nk?.startsWith(MANAGED_TAG_PREFIX)) managed.set(nk.slice(MANAGED_TAG_PREFIX.length), seg);
  }

  const results = [];
  for (const s of segments) {
    const nameKey = `${MANAGED_TAG_PREFIX}${s.key}`;
    const tag = await prisma.tag.upsert({
      where: { shop_nameKey: { shop: INTERNAL_SHOP, nameKey } },
      create: { shop: INTERNAL_SHOP, name: nameKey, nameKey, color: "purple" },
      update: {},
    });
    const name = `M360 · ${String(s.name).trim().slice(0, 80)}`;
    const description = `Managed by Merchant360 — edit its rules there. ${String(s.description || "").slice(0, 300)}`.trim();
    const filterTree = { type: "group", match: "all", children: [{ type: "rule", field: "hasTag", op: "has", value: tag.id }] };
    const current = managed.get(s.key);
    if (current) {
      if (current.name !== name || current.description !== description) {
        await prisma.segment.update({ where: { id: current.id }, data: { name, description } });
      }
      results.push({ key: s.key, segmentId: current.id, tag: nameKey, status: "exists" });
    } else {
      const created = await prisma.segment.create({
        data: { shop: INTERNAL_SHOP, name, description, kind: "dynamic", filterTree },
      });
      results.push({ key: s.key, segmentId: created.id, tag: nameKey, status: "created" });
    }
  }

  let removed = 0;
  if (prune) {
    const keep = new Set(segments.map((s) => s.key));
    for (const [key, seg] of managed) {
      if (keep.has(key)) continue;
      await prisma.segment.update({ where: { id: seg.id }, data: { deletedAt: new Date() } });
      removed += 1;
    }
  }
  return { ok: true, segments: results, removed };
}
