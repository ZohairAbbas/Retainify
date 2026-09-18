/**
 * Segment templates for this workspace, each with a live count and the best
 * few marked as recommended.
 *
 * "Recommended" means: it would match someone today, the merchant hasn't
 * already saved a segment by that name, and it ranks highest by the
 * template's priority. A template that matches nobody is still offered (the
 * audience may grow into it), just never recommended — suggesting an empty
 * segment is the fastest way to teach people to ignore the badge.
 */
import { templatesFor } from "./fields.server.js";
import { countSegmentTree } from "./evaluator.server.js";

const MAX_RECOMMENDED = 3;
const DEFAULT_PRIORITY = 40;

export async function segmentTemplatesWithCounts(shop, { isShopify, propertyDefs = [], savedNames = [] }) {
  const templates = templatesFor(isShopify, propertyDefs);
  const counts = await Promise.all(
    templates.map((t) => countSegmentTree(shop, t.rules).catch(() => null)),
  );
  const taken = new Set(savedNames.map((n) => String(n || "").trim().toLowerCase()));

  const withCounts = templates.map((t, i) => ({
    ...t,
    count: counts[i],
    alreadySaved: taken.has(t.name.toLowerCase()),
  }));
  const recommended = new Set(
    withCounts
      .filter((t) => t.count > 0 && !t.alreadySaved)
      .sort((a, b) => (b.priority ?? DEFAULT_PRIORITY) - (a.priority ?? DEFAULT_PRIORITY))
      .slice(0, MAX_RECOMMENDED)
      .map((t) => t.id),
  );
  // Recommended first (in priority order), then the rest in library order.
  const rank = (t) => (recommended.has(t.id) ? -(t.priority ?? DEFAULT_PRIORITY) : 0);
  return withCounts
    .map((t, i) => ({ ...t, recommended: recommended.has(t.id), _i: i }))
    .sort((a, b) => rank(a) - rank(b) || a._i - b._i)
    .map(({ _i, ...t }) => t);
}
