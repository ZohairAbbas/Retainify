// POST /app/segments/preview — used by the Segment Builder live preview pane.
// Body: filterTree (JSON string).
// Returns: { count, sample, lifecycleMix }.
//
// No `capped`: counts are exact at any audience size now that every rule
// compiles to a WHERE. See the evaluator header.

import { requireAccount } from "../lib/auth/require.server.js";
import { evaluateSegment, validateFilterTree } from "../lib/segments/evaluator.server.js";

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const raw = String(fd.get("filterTree") || "null");

  let tree = null;
  try {
    tree = JSON.parse(raw);
  } catch (_e) {
    return Response.json({ count: 0, sample: [], lifecycleMix: null });
  }
  if (tree) {
    try {
      validateFilterTree(tree);
    } catch (_e) {
      return Response.json({ count: 0, sample: [], lifecycleMix: null });
    }
  }

  const { count, sample, lifecycleMix } = await evaluateSegment(
    shop,
    { kind: "dynamic", filterTree: tree },
    { sampleSize: 5 },
  );
  return Response.json({ count, sample, lifecycleMix });
};

// Loader is a no-op — the route is action-only. Still authenticated, so a
// stray GET can't be used to probe whether the route exists.
export const loader = async ({ request }) => {
  await requireAccount(request);
  return Response.json({ ok: true });
};
