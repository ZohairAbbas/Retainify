// GET /app/segments/search?q=... — tiny contact-search endpoint used by the
// Segment Builder's static-member picker. Returns up to 10 matches.

import { authenticate } from "../shopify.server.js";
import { listContacts } from "../lib/contacts/contacts.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json({ contacts: [] });

  const { rows } = await listContacts({ shop, status: "all", source: "all", tagId: "all", search: q, limit: 10 });
  return Response.json({
    contacts: rows.map((c) => ({ id: c.id, email: c.email, name: c.name })),
  });
};
