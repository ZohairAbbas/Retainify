import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

// Legacy redirect: /app/journey was the Cart Rescue editor (one journey per shop).
// Cart Rescue is now a regular Journey row. Redirect to it if a migrated
// row exists (source='cart_rescue_legacy'), otherwise to the Automations list.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const journey = await prisma.journey.findFirst({
    where: { shop, trigger: "cart_abandoned", source: "cart_rescue_legacy" },
    select: { id: true },
  });

  const target = journey
    ? `/app/automations/${journey.id}${url.search}`
    : `/app/automations${url.search}`;

  return redirect(target);
};

export default function LegacyJourneyRedirect() {
  return null;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
