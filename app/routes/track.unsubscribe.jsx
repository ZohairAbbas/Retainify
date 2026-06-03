import prisma from "../db.server.js";
import { evaluateExitCriteria } from "../lib/journey/exit-criteria.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";

// Public route — one-click unsubscribe.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const email = url.searchParams.get("email");

  if (shop && email) {
    await prisma.emailSuppression.upsert({
      where: { shop_email: { shop, email } },
      create: { shop, email, reason: "unsubscribe" },
      update: { reason: "unsubscribe" },
    });
    await upsertContact({
      shop,
      email,
      subscriptionStatus: "unsubscribed",
    }).catch((err) =>
      console.error("[unsubscribe] upsertContact failed:", err.message),
    );
    await evaluateExitCriteria(shop, email, "unsubscribed").catch((err) =>
      console.error("[unsubscribe] exit-criteria failed:", err.message),
    );
  }

  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>Unsubscribed</title></head>
<body style="font-family:sans-serif;text-align:center;padding:80px 20px;">
  <h2>You've been unsubscribed.</h2>
  <p style="color:#666;">You will no longer receive cart recovery emails from this store.</p>
</body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
};
