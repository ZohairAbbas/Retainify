/**
 * app/uninstalled.
 *
 * Deleting the session is not enough on its own. ShopSettings, Journey and every
 * queued JourneyJob / PushJob / WhatsappJob survive an uninstall, and the 60s
 * workers keep claiming due jobs — so without this the app carries on emailing
 * the customers of a store that removed it, right up until shop/redact lands 48
 * hours later.
 *
 * Pending work is cancelled rather than left pending: an uninstall is an
 * unambiguous signal, and leaving the rows claimable means every worker tick
 * keeps picking them up.
 *
 * Published journeys are PAUSED too. This reverses an earlier choice to leave
 * them published so a reinstall resumed automatically without republishing:
 * that convenience means a shop returning after weeks away immediately fires
 * live triggers at a contact list that went cold, and the sends cannot be taken
 * back. Republishing costs the merchant seconds. Nothing records that the pause
 * was automatic, so a returning merchant sees their flows paused with no
 * explanation — a deliberate trade for now, revisit if support asks about it.
 */
import { authenticate } from "../shopify.server.js";
import db from "../db.server.js";
import { stopShopSending } from "../lib/journey/shop-work.server.js";
import { forgetShopHealth } from "../lib/shopify/shop-health.server.js";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const { jobs, journeys } = await stopShopSending(shop, "app uninstalled");

  console.log(
    `[uninstall] ${shop} — cancelled ${jobs.byQueue.email} email, ${jobs.byQueue.push} push, ` +
      `${jobs.byQueue.whatsapp} whatsapp jobs; paused ${journeys.automations} automation(s), ` +
      `${journeys.broadcasts} broadcast(s)`,
  );

  // The workers cache health verdicts; a stale "live" must not outlive the
  // uninstall, and a stale "uninstalled" must not survive a reinstall.
  forgetShopHealth(shop);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
