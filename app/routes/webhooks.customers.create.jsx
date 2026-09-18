import { authenticate } from "../shopify.server.js";
import { enrollInAllFlows } from "../lib/journey/journey-queue.server.js";
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

  // The trigger is "Subscribed to Marketing", so only a customer who is. It
  // used to enrol every new customer with an email — someone who checked out
  // without ticking the box got the whole welcome series anyway, because flows
  // (unlike broadcasts) never look at consent. The contact is still stored
  // above either way; they just aren't mailed marketing they didn't ask for.
  if (isSubscribed) {
    await enrollInAllFlows(shop, "customer_created", email, name, {}).catch((err) =>
      console.error("[webhook] welcome enroll failed:", err.message),
    );
  }

  return new Response(null, { status: 200 });
};
