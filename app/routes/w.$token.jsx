/**
 * Public WhatsApp click redirect.
 *
 * Every URL button on a template created in Retainify points here rather than
 * at the merchant's store. Meta reports template button taps only as
 * template-level aggregates — counts per template per period, with no wamid and
 * no recipient — so a tap could never be tied to a person, and therefore never
 * to their order. Routing it through us is the only way WhatsApp can earn
 * revenue attribution, and it is exactly what push already does
 * (track.push-click.jsx).
 *
 * The token is `<WhatsappJob id>-<button index>`, filled into the button's
 * approved `{{1}}` variable at send time. It resolves to one job, one
 * recipient, and one destination.
 *
 * Threat model matches the push beacon: a forged token can mark one job clicked
 * and inflate a merchant's own stats. That does not justify a signature on a
 * link people tap from a phone, but it does justify the write being strictly
 * idempotent and the redirect target never coming from the URL — only ever from
 * the template row, so this can't be used as an open redirect.
 */
import { redirect } from "react-router";
import prisma from "../db.server.js";
import { hit, clientIp } from "../lib/security/rate-limit.server.js";

/** Where a shopper goes when we cannot resolve a real destination. */
const FALLBACK = "https://www.whatsapp.com";

export const loader = async ({ params, request }) => {
  const token = String(params.token || "");

  // A tap always ends in a redirect, never an error page: the shopper is a
  // customer of the merchant, and a broken link is the merchant's problem to
  // see in reporting, not the shopper's to read about.
  const dash = token.lastIndexOf("-");
  if (dash < 1) return redirect(FALLBACK);

  const jobId = token.slice(0, dash);
  const index = Number(token.slice(dash + 1));
  if (!jobId || jobId.length > 64 || !Number.isInteger(index) || index < 0) {
    return redirect(FALLBACK);
  }

  const job = await prisma.whatsappJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      shop: true,
      sentAt: true,
      step: { select: { waTemplateName: true, waLanguage: true } },
    },
  });
  if (!job?.step?.waTemplateName) return redirect(FALLBACK);

  const template = await prisma.whatsappTemplate.findUnique({
    where: {
      shop_name_language: {
        shop: job.shop,
        name: job.step.waTemplateName,
        language: job.step.waLanguage || "en_US",
      },
    },
    select: { buttonUrls: true },
  });

  const destination = resolveDestination(template?.buttonUrls, index);

  // Record the click only when we actually sent the shopper to the merchant.
  // Attribution reads this as "the tap brought them to the store", so a tap we
  // could not resolve — a token for a template with no stored destination, or a
  // button index that no longer exists — must not earn revenue credit for the
  // bounce to the fallback.
  //
  // Rate limit the WRITE, not the redirect: a shopper whose network retries
  // must still reach the store.
  const ip = clientIp(request);
  if (destination && hit(`waclick:ip:${ip}`, 60, 60 * 1000).allowed) {
    // Idempotent: only the first tap is recorded, so re-opening the link from
    // chat history cannot move the original timestamp or double-count.
    await prisma.whatsappJob
      .updateMany({
        where: { id: jobId, clickedAt: null, sentAt: { not: null } },
        data: { clickedAt: new Date() },
      })
      .catch((err) => console.error("[wa-click] write failed:", err.message));
  }

  return redirect(destination || FALLBACK);
};

/**
 * The merchant's real link for one button position.
 *
 * Read from the template rather than the token, so a crafted token can only
 * ever land on a URL the merchant themselves configured — never an arbitrary
 * host. Http(s) only, for the same reason.
 */
function resolveDestination(buttonUrls, index) {
  if (!buttonUrls || typeof buttonUrls !== "object") return "";
  const raw = String(buttonUrls[index] ?? buttonUrls[String(index)] ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}
