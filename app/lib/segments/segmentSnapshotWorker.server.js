// Daily segment snapshot worker.
//
// Writes one SegmentSnapshot row per non-deleted segment + per system
// segment, per UTC day. After writing, prunes anything older than 30 days
// for that segmentKey so the table stays bounded.
//
// Called by the same 60s tick as the enrollment worker but no-ops unless
// ≥24h have passed since this shop's last snapshot run.

import prisma from "../../db.server.js";
import { evaluateSegment } from "./evaluator.server.js";
import { SYSTEM_SEGMENTS } from "./systemSegments.server.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

/**
 * Iterate every shop that has at least one segment, snapshot if due.
 * Idempotent — safe to call every tick.
 */
export async function runSegmentSnapshotWorker() {
  // Use distinct shops from ShopSettings as the worklist. (Every install has
  // a ShopSettings row.)
  const settings = await prisma.shopSettings.findMany({
    select: { shop: true, lastSegmentSnapshotAt: true },
  });
  for (const s of settings) {
    if (!isDue(s.lastSegmentSnapshotAt)) continue;
    try {
      await snapshotShop(s.shop);
    } catch (e) {
      console.error(`[segment-snapshot] ${s.shop} failed:`, e);
    }
  }
}

function isDue(lastAt) {
  if (!lastAt) return true;
  return Date.now() - new Date(lastAt).getTime() >= ONE_DAY_MS;
}

async function snapshotShop(shop) {
  const userSegments = await prisma.segment.findMany({
    where: { shop, deletedAt: null },
    select: { id: true, kind: true, filterTree: true },
  });

  const now = new Date();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * ONE_DAY_MS);

  // User segments
  for (const seg of userSegments) {
    try {
      const { count } = await evaluateSegment(shop, seg, { sampleSize: 0 });
      await prisma.segmentSnapshot.create({
        data: { shop, segmentKey: seg.id, takenAt: now, count },
      });
      await prisma.segmentSnapshot.deleteMany({
        where: { shop, segmentKey: seg.id, takenAt: { lt: cutoff } },
      });
    } catch (e) {
      console.error(`[segment-snapshot] segment ${seg.id} failed:`, e);
    }
  }

  // System segments
  for (const seg of SYSTEM_SEGMENTS) {
    try {
      const { count } = await evaluateSegment(shop, seg, { sampleSize: 0 });
      await prisma.segmentSnapshot.create({
        data: { shop, segmentKey: seg.id, takenAt: now, count },
      });
      await prisma.segmentSnapshot.deleteMany({
        where: { shop, segmentKey: seg.id, takenAt: { lt: cutoff } },
      });
    } catch (e) {
      console.error(`[segment-snapshot] system ${seg.id} failed:`, e);
    }
  }

  await prisma.shopSettings.update({
    where: { shop },
    data: { lastSegmentSnapshotAt: now },
  });
}
