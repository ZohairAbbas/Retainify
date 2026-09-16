/**
 * Store a web-push subscription for a storefront visitor.
 *
 * Served through the Shopify app proxy (/apps/retainify/push-subscribe), so the
 * shop is taken from the signed query string rather than the request body. It
 * used to come from the body with no auth at all, which let anyone create
 * subscriptions for any shop and flip Contact.pushEnabled for any email address
 * they cared to name.
 */
import prisma from "../db.server.js";
import { normalizeEmail } from "../lib/contacts/contacts.server.js";
import { recalcContactPushEnabled } from "../lib/contacts/engagement.server.js";
import { verifyAppProxy, PROXY_CORS } from "../lib/security/app-proxy.server.js";

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: PROXY_CORS });
  }

  const auth = await verifyAppProxy(request);
  if (!auth.ok) return auth.response;
  const { shop } = auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: PROXY_CORS });
  }

  // `shop` is deliberately NOT read from the body — the signed value above is
  // the only one that means anything. A body field of the same name is ignored.
  const { endpoint, p256dh, auth: authKey, anonId } = body;
  if (!endpoint || !p256dh || !authKey) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: PROXY_CORS });
  }

  // The email is a claim by the page, not a verified identity: the proxy
  // signature proves which shop the request came from, never who is behind the
  // browser. Anyone could previously pass another shopper's address here and
  // attach a push endpoint to them.
  //
  // So it is stored on the subscription — where it is a hint that this browser
  // said it belonged to that address — but it no longer drives the Contact
  // rollup. The link is made later, by a signal that actually carries proof:
  // the double opt-in confirm link, which only the inbox owner can click.
  const claimedEmail = normalizeEmail(body.contactEmail) || null;
  const contactEmail = await confirmedContactEmail(shop, claimedEmail);

  await prisma.pushSubscription.upsert({
    where: { shop_endpoint: { shop, endpoint } },
    create: {
      shop,
      endpoint,
      p256dh,
      auth: authKey,
      anonId: anonId ?? null,
      contactEmail,
    },
    update: {
      isActive: true,
      p256dh,
      auth: authKey,
      ...(anonId ? { anonId } : {}),
      ...(contactEmail ? { contactEmail } : {}),
    },
  });

  if (contactEmail) {
    // Only reached for an already-confirmed contact, so this can no longer be
    // used to set pushEnabled on someone who never opted in.
    recalcContactPushEnabled(shop, contactEmail).catch((err) =>
      console.error("[push-subscribe] pushEnabled rollup failed:", err.message),
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: PROXY_CORS });
};

/**
 * Accept the page's claimed email only where the app already holds proof.
 *
 * A contact that exists for this shop and has confirmed its address — through
 * the double opt-in link, a Shopify customer record, or any other path that
 * already set a real subscription status — is someone we know. Linking a push
 * endpoint to them adds no information an attacker could not already infer.
 *
 * An address we have never seen is not created here. That was the hole: the
 * route called upsertContact, so naming any address brought a contact into
 * existence with pushEnabled set.
 *
 * @returns {Promise<string|null>} the email to store, or null to leave unlinked
 */
async function confirmedContactEmail(shop, claimedEmail) {
  if (!claimedEmail) return null;

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop, email: claimedEmail } },
    select: { subscriptionStatus: true, deletedAt: true },
  });
  if (!contact || contact.deletedAt) return null;

  // "never_opted_in" is a contact we have merely observed — a checkout email, an
  // import — with no act of consent behind it. Not proof of who is browsing.
  const proven = contact.subscriptionStatus === "subscribed";
  return proven ? claimedEmail : null;
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
