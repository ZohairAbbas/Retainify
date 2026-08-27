import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";

// Legacy redirect: /app/journey was the Cart Rescue editor (one journey per shop).
// Cart Rescue is now a regular Journey row. Redirect to it if a migrated
// row exists (source='cart_rescue_legacy'), otherwise to the Flows list. (The section
// was renamed from "automations" to "flows"; this redirect still pointed at the
// old path, so every legacy link 404d.)
export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const url = new URL(request.url);

  const journey = await prisma.journey.findFirst({
    where: { shop, trigger: "cart_abandoned", source: "cart_rescue_legacy" },
    select: { id: true },
  });

  const target = journey
    ? `/app/flows/${journey.id}${url.search}`
    : `/app/flows${url.search}`;

  return redirect(target);
};

export default function LegacyJourneyRedirect() {
  return null;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
