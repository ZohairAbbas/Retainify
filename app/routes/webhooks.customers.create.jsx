import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { enrollContact } from "../lib/journey/journey-queue.server.js";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const email = payload.email;
  if (!email) return new Response(null, { status: 200 });

  const firstName = payload.first_name || "";
  const lastName = payload.last_name || "";
  const name = [firstName, lastName].filter(Boolean).join(" ");

  const journey = await prisma.journey.findFirst({
    where: { shop, trigger: "customer_created", isActive: true },
  });
  if (!journey) return new Response(null, { status: 200 });

  await enrollContact(journey.id, email, name, {}).catch((err) =>
    console.error("[webhook] welcome enroll failed:", err.message),
  );

  return new Response(null, { status: 200 });
};
