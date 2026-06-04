// System segments — hard-coded, virtual "always pinned" segments.
// They aren't stored in the DB. The detail page treats them as read-only.

import { evaluateSegment } from "./evaluator.server.js";

const SEVEN_DAYS = 7;
const ONE_DAY = 1;

export const SYSTEM_SEGMENTS = [
  {
    id: "sys_all",
    name: "All contacts",
    description: "Everyone in your audience",
    icon: "Users",
    kind: "dynamic",
    system: true,
    filterTree: null, // null → matches all contacts in shop
  },
  {
    id: "sys_subscribed",
    name: "Subscribed",
    description: "Email opt-ins, not unsubscribed or bounced",
    icon: "Check",
    kind: "dynamic",
    system: true,
    filterTree: {
      type: "group", match: "all", children: [
        { type: "rule", field: "subscriptionStatus", op: "is", value: "subscribed" },
      ],
    },
  },
  {
    id: "sys_unsub",
    name: "Unsubscribed",
    description: "Suppressed contacts — no marketing sends",
    icon: "Close",
    kind: "dynamic",
    system: true,
    filterTree: {
      type: "group", match: "any", children: [
        { type: "rule", field: "subscriptionStatus", op: "is", value: "unsubscribed" },
        { type: "rule", field: "subscriptionStatus", op: "is", value: "bounced" },
        { type: "rule", field: "subscriptionStatus", op: "is", value: "complained" },
      ],
    },
  },
  {
    id: "sys_new",
    name: "New (this week)",
    description: "First seen in the last 7 days",
    icon: "Sparkle",
    kind: "dynamic",
    system: true,
    filterTree: {
      type: "group", match: "all", children: [
        { type: "rule", field: "firstSeenAt", op: "in_last", value: SEVEN_DAYS, unit: "days" },
      ],
    },
  },
  {
    id: "sys_atrisk",
    name: "At-risk customers",
    description: "Last activity 31–90 days ago",
    icon: "Clock",
    kind: "dynamic",
    system: true,
    filterTree: {
      type: "group", match: "all", children: [
        { type: "rule", field: "lifecycleStage", op: "is", value: "at_risk" },
      ],
    },
  },
  {
    id: "sys_churned",
    name: "Churned customers",
    description: "Last activity more than 90 days ago",
    icon: "Exit",
    kind: "dynamic",
    system: true,
    filterTree: {
      type: "group", match: "all", children: [
        { type: "rule", field: "lifecycleStage", op: "is", value: "churned" },
      ],
    },
  },
];

const BY_ID = Object.fromEntries(SYSTEM_SEGMENTS.map((s) => [s.id, s]));

export function getSystemSegmentById(id) {
  return BY_ID[id] || null;
}

export function isSystemSegmentId(id) {
  return Boolean(BY_ID[id]);
}

/**
 * Evaluate counts for the quick-views rail. Returns an array of
 * { ...systemSegment, contactCount } shaped the same as user segments
 * so the UI can treat them uniformly.
 */
export async function listSystemSegmentsWithCounts(shop) {
  const results = await Promise.all(
    SYSTEM_SEGMENTS.map(async (seg) => {
      try {
        const { count } = await evaluateSegment(shop, seg, { sampleSize: 0 });
        return { ...seg, contactCount: count };
      } catch (_e) {
        return { ...seg, contactCount: 0 };
      }
    }),
  );
  return results;
  // ONE_DAY is unused at runtime but reserved for a future "active today" segment.
  void ONE_DAY;
}
