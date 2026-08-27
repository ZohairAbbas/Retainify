/**
 * "Send test" for the email editor.
 *
 * Runs the merchant's draft through the SAME render and send path a live job
 * uses — same renderer, same merge-tag substitution, same branding entitlement,
 * same unsubscribe guarantee, same provider adapter. A preview that takes a
 * different path is worse than none, because it builds confidence in output
 * nobody will ever receive.
 *
 * Two deliberate differences from a real send:
 *   - merge tags resolve to obvious sample values rather than empty strings, so
 *     the merchant can see where each one lands;
 *   - the subject is prefixed, so a test can never be mistaken for the real
 *     thing sitting in someone's inbox.
 *
 * Test sends do NOT increment usage counters: the merchant is checking their
 * own work, and billing them for it would discourage exactly the behaviour we
 * want.
 */
import prisma from "../../db.server.js";
import { sendEmail, resolveFrom, resolveProvider, resolveCartUrl, resolveStoreUrl } from "./index.server.js";
import { renderVisualEmail, renderCustomHtmlEmail, brandingFooterHtml } from "./visual-renderer.server.js";
import { buildTextPart } from "./text.server.js";
import { buildUnsubscribeUrl, listUnsubscribeHeaders } from "../tracking/links.server.js";
import { normalizeEmail } from "../contacts/contacts.server.js";
import { hit } from "../security/rate-limit.server.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Per shop, not per address: the limit exists to stop the editor being turned
// into a relay, and an attacker would just vary the recipient.
const TEST_LIMIT = 20;
const TEST_WINDOW_MS = 60 * 60 * 1000;

/**
 * @param {object} args
 * @param {string} args.shop
 * @param {string} args.to               recipient chosen by the merchant
 * @param {string} args.subject
 * @param {"blocks"|"html"} args.emailMode
 * @param {string} args.emailHtml        raw HTML when emailMode === "html"
 * @param {Array}  args.emailBlocks      block array when emailMode === "blocks"
 * @param {object} args.emailBrand
 * @returns {Promise<{ok: boolean, error?: string, sentTo?: string}>}
 */
export async function sendTestEmail({
  shop,
  to,
  subject,
  emailMode,
  emailHtml,
  emailBlocks,
  emailBrand,
}) {
  const recipient = normalizeEmail(to);
  if (!recipient || !EMAIL_RE.test(recipient)) {
    return { ok: false, error: "Enter a valid email address to send the test to." };
  }

  if (!hit(`testsend:${shop}`, TEST_LIMIT, TEST_WINDOW_MS).allowed) {
    return {
      ok: false,
      error: "You've sent a lot of tests in the last hour. Try again shortly.",
    };
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return { ok: false, error: "Finish setting up your sender details before sending a test." };
  }

  // A real, signed unsubscribe URL so the merchant can click it and see the
  // page their customers will get. Safe to include: the link's GET is now
  // non-mutating — it renders a confirmation page and changes nothing until
  // the button on it is pressed.
  const unsubscribeUrl = buildUnsubscribeUrl({ shop, email: recipient });

  // Bracketed tokens, not sample names.
  //
  // Empty strings would render a technically accurate but useless preview. A
  // realistic-looking name is worse: a merchant who sees "Hi Alex" reasonably
  // asks where Alex came from, and may conclude the tag pulled real data. These
  // show exactly where each tag lands while being unmistakably placeholders.
  //
  // Values we genuinely know — the store name and URLs — use the real thing,
  // because those are what will actually be substituted at send time.
  const ctx = {
    first_name: "[First name]",
    last_name: "[Last name]",
    store_name: settings.senderName || shop.replace(".myshopify.com", ""),
    // Same resolution the worker uses, so the test is a true preview. A direct
    // workspace with no website set gets "" rather than a fabricated host.
    store_url: resolveStoreUrl({ shop, settings }),
    discount_code: "[DISCOUNT-CODE]",
    cart_url: resolveCartUrl({ shop, settings }),
    unsubscribeUrl,
  };

  let html;
  try {
    if (emailMode === "html") {
      if (!String(emailHtml || "").trim()) {
        return { ok: false, error: "There's no HTML to send yet — paste your template first." };
      }
      html = renderCustomHtmlEmail({
        html: emailHtml,
        ctx,
        stepId: "test",
        branding: await brandingFooterHtml(shop),
      });
    } else {
      const blocks = Array.isArray(emailBlocks) ? emailBlocks : [];
      if (blocks.length === 0) {
        return { ok: false, error: "Add at least one block before sending a test." };
      }
      html = await renderVisualEmail({
        blocks,
        brand: emailBrand || {},
        ctx,
        stepId: "test",
        shop,
      });
    }
  } catch (err) {
    console.error("[test-send] render failed:", err);
    return { ok: false, error: `Could not render this email: ${err.message}` };
  }

  const provider = resolveProvider(settings);
  const { from, replyTo } = resolveFrom({ settings, provider });
  const testSubject = `[Test] ${subject || "(no subject)"}`;

  const result = await sendEmail(
    {
      to: recipient,
      from,
      replyTo,
      subject: testSubject,
      html,
      text: buildTextPart({ html, unsubscribeUrl }),
      headers: listUnsubscribeHeaders({ unsubscribeUrl }),
      // Distinct per send so repeated tests after an edit are never deduped by
      // the provider — the merchant is iterating and expects each one to arrive.
      idempotencyKey: `test:${shop}:${Date.now()}`,
    },
    { shop, settings },
  );

  if (!result.ok) {
    return { ok: false, error: result.error || "The provider rejected this send." };
  }

  console.log(`[test-send] shop=${shop} delivered test email`);
  return { ok: true, sentTo: recipient };
}
