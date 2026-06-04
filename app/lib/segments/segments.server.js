// Segment CRUD — thin Prisma wrappers, with eval-driven count cache.
//
// listSegments returns user-defined segments (non-deleted) plus a fresh count
// cache. If a segment's `contactCount` is stale (> COUNT_TTL_MS), we
// re-evaluate inline on read. Counts are also recomputed on every create /
// update so the saved state is accurate immediately.

import prisma from "../../db.server.js";
import { evaluateSegment, validateFilterTree } from "./evaluator.server.js";

const COUNT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isStale(ts) {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > COUNT_TTL_MS;
}

function normaliseInput({ name, description, kind, filterTree }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("Segment name is required");
  if (kind !== "dynamic" && kind !== "static") {
    throw new Error(`Invalid segment kind: ${kind}`);
  }
  if (kind === "dynamic") {
    if (!filterTree) throw new Error("Dynamic segments require a filter tree");
    validateFilterTree(filterTree);
  }
  return {
    name: trimmedName,
    description: String(description || "").trim(),
    kind,
    filterTree: kind === "dynamic" ? filterTree : null,
  };
}

export async function listSegments(shop) {
  const rows = await prisma.segment.findMany({
    where: { shop, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });

  // Refresh stale counts inline. Done sequentially — segment lists are
  // small in practice (tens, not hundreds) and the evaluator can be heavy.
  const out = [];
  for (const seg of rows) {
    if (isStale(seg.lastComputedAt)) {
      try {
        const { count } = await evaluateSegment(shop, seg, { sampleSize: 0 });
        const updated = await prisma.segment.update({
          where: { id: seg.id },
          data: { contactCount: count, lastComputedAt: new Date() },
        });
        out.push(updated);
      } catch (_e) {
        out.push(seg);
      }
    } else {
      out.push(seg);
    }
  }
  return out;
}

export async function getSegmentById(shop, id) {
  return prisma.segment.findFirst({
    where: { id, shop, deletedAt: null },
  });
}

export async function createSegment(shop, input) {
  const data = normaliseInput(input);
  const segment = await prisma.segment.create({
    data: {
      shop,
      name: data.name,
      description: data.description,
      kind: data.kind,
      filterTree: data.filterTree,
      contactCount: 0,
      lastComputedAt: null,
    },
  });

  // Seed static members if provided.
  const memberIds = Array.isArray(input.memberContactIds) ? input.memberContactIds : [];
  if (segment.kind === "static" && memberIds.length) {
    await prisma.segmentMembership.createMany({
      data: memberIds.map((cid) => ({ segmentId: segment.id, contactId: cid })),
      skipDuplicates: true,
    });
  }

  return refreshCount(shop, segment.id);
}

export async function updateSegment(shop, id, patch) {
  const existing = await getSegmentById(shop, id);
  if (!existing) throw new Error("Segment not found");

  const merged = normaliseInput({
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    kind: patch.kind ?? existing.kind,
    filterTree: patch.filterTree !== undefined ? patch.filterTree : existing.filterTree,
  });

  await prisma.segment.update({
    where: { id },
    data: {
      name: merged.name,
      description: merged.description,
      kind: merged.kind,
      filterTree: merged.filterTree,
    },
  });

  return refreshCount(shop, id);
}

export async function refreshCount(shop, id) {
  const seg = await getSegmentById(shop, id);
  if (!seg) return null;
  try {
    const { count } = await evaluateSegment(shop, seg, { sampleSize: 0 });
    return prisma.segment.update({
      where: { id },
      data: { contactCount: count, lastComputedAt: new Date() },
    });
  } catch (_e) {
    return seg;
  }
}

export async function duplicateSegment(shop, id) {
  const seg = await getSegmentById(shop, id);
  if (!seg) throw new Error("Segment not found");
  const copy = await prisma.segment.create({
    data: {
      shop,
      name: `${seg.name} (copy)`,
      description: seg.description,
      kind: seg.kind,
      filterTree: seg.filterTree ?? null,
      contactCount: 0,
      lastComputedAt: null,
    },
  });
  if (copy.kind === "static") {
    const members = await prisma.segmentMembership.findMany({
      where: { segmentId: seg.id },
    });
    if (members.length) {
      await prisma.segmentMembership.createMany({
        data: members.map((m) => ({ segmentId: copy.id, contactId: m.contactId })),
        skipDuplicates: true,
      });
    }
  }
  return refreshCount(shop, copy.id);
}

export async function softDeleteSegment(shop, id) {
  const inUse = await isSegmentUsedInFlows(shop, id);
  if (inUse) {
    const err = new Error("Segment is referenced by a published flow");
    err.code = "SEGMENT_IN_USE";
    throw err;
  }
  await prisma.segment.updateMany({
    where: { id, shop },
    data: { deletedAt: new Date() },
  });
}

// Stub — flows don't reference segments in v1. Wire up when the
// `segment_entered` trigger ships.
export async function isSegmentUsedInFlows(_shop, _segmentId) {
  return false;
}

// ── Static membership ──────────────────────────────────────────────────

export async function addStaticMember(shop, segmentId, contactId) {
  const seg = await getSegmentById(shop, segmentId);
  if (!seg || seg.kind !== "static") return;
  await prisma.segmentMembership.upsert({
    where: { segmentId_contactId: { segmentId, contactId } },
    create: { segmentId, contactId },
    update: {},
  });
  await refreshCount(shop, segmentId);
}

export async function removeStaticMember(shop, segmentId, contactId) {
  await prisma.segmentMembership.deleteMany({
    where: { segmentId, contactId },
  });
  await refreshCount(shop, segmentId);
}

export async function listStaticMemberIds(segmentId) {
  const rows = await prisma.segmentMembership.findMany({
    where: { segmentId },
    select: { contactId: true },
  });
  return rows.map((r) => r.contactId);
}

// ── Build a filter tree from current Contacts list filters ─────────────
// Powers "Save as segment" from the Contacts page.
export function filtersToTree({ status, source, tagId, search }) {
  const children = [];
  if (status && status !== "all") {
    children.push({ type: "rule", field: "subscriptionStatus", op: "is", value: status });
  }
  if (source && source !== "all") {
    children.push({ type: "rule", field: "source", op: "is", value: source });
  }
  if (tagId && tagId !== "all") {
    children.push({ type: "rule", field: "hasTag", op: "has", value: tagId });
  }
  // `search` is not representable as a rule — surface a stub only if there
  // are no other filters, so the segment isn't accidentally "everyone".
  if (children.length === 0) {
    children.push({ type: "rule", field: "subscriptionStatus", op: "is", value: "subscribed" });
  }
  return { type: "group", match: "all", children };
}
