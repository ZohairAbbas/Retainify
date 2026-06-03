import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { enrollContact } from "../lib/journey/journey-queue.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const email = payload.email;
  if (!email) return new Response(null, { status: 200 });

  const firstName = payload.first_name || "";
  const lastName = payload.last_name || "";
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const marketingState = payload.email_marketing_consent?.state || "";
  const isSubscribed = marketingState.toLowerCase() === "subscribed";

  // Mirror to Contact regardless of whether a welcome journey is wired up.
  await upsertContact({
    shop,
    email,
    name,
    source: "shopify_customer",
    shopifyCustomerId: payload.admin_graphql_api_id || null,
    subscriptionStatus: isSubscribed ? "subscribed" : undefined,
    marketingConsentAt: isSubscribed
      ? payload.email_marketing_consent?.consent_updated_at || new Date()
      : null,
  }).catch((err) =>
    console.error("[webhook] upsertContact (customers.create) failed:", err.message),
  );

  const journey = await prisma.journey.findFirst({
    where: { shop, trigger: "customer_created", status: "published" },
  });
  if (!journey) return new Response(null, { status: 200 });

  await enrollContact(journey.id, email, name, {}).catch((err) =>
    console.error("[webhook] welcome enroll failed:", err.message),
  );

  return new Response(null, { status: 200 });
};
