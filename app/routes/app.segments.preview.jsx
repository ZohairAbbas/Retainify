// POST /app/segments/preview — used by the Segment Builder live preview pane.
// Body: filterTree (JSON string).
// Returns: { count, sample, lifecycleMix, capped }.

import { authenticate } from "../shopify.server.js";
import { evaluateSegment, validateFilterTree } from "../lib/segments/evaluator.server.js";

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const raw = String(fd.get("filterTree") || "null");

  let tree = null;
  try {
    tree = JSON.parse(raw);
  } catch (_e) {
    return Response.json({ count: 0, sample: [], lifecycleMix: null, capped: false });
  }
  if (tree) {
    try {
      validateFilterTree(tree);
    } catch (_e) {
      return Response.json({ count: 0, sample: [], lifecycleMix: null, capped: false });
    }
  }

  const { count, sample, lifecycleMix, capped } = await evaluateSegment(
    shop,
    { kind: "dynamic", filterTree: tree },
    { sampleSize: 5 },
  );
  return Response.json({ count, sample, lifecycleMix, capped });
};

// Loader is a no-op — the route is action-only.
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return Response.json({ ok: true });
};
