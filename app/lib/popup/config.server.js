/**
 * What the storefront script is told about a popup. Shared by the Shopify
 * proxy route and the website embed so they can never disagree.
 */
import prisma from "../../db.server.js";
import { rtPopupKit } from "../popup-templates/kit.js";

/** Templates with no room for the phone + consent fields (see kit.js). */
const NO_WHATSAPP_TEMPLATES = new Set(
  Object.entries(rtPopupKit({ esc: String, rich: String, wa: () => "", preview: false }).templates)
    .filter(([, t]) => t.noWhatsapp)
    .map(([id]) => id),
);

/**
 * Whether signing up earns a code. A Shopify store mints a unique code per
 * signup whenever the popup offers a discount; any other website only has
 * the code the merchant typed in, if any. A newsletter popup offers none.
 */
export function popupHasOffer(config, { isShopify }) {
  if (!config || config.template === "newsletter") return false;
  if (isShopify) return (Number(config.discount) || 0) > 0;
  return Boolean(String(config.offerCode || "").trim());
}

// Templates from the shared kit (kit.js). A Shopify storefront still running
// an older theme-extension build doesn't know them and falls back to the
// Editorial layout, which reads `headline` and `masthead` — so those are
// filled in for it. A current build ignores the extra keys.
const KIT_IDS = new Set(["spotlight", "twostep", "slidein", "countdown", "newsletter", "bar"]);
function legacyFallback(config, template, isShopify) {
  if (!isShopify || !KIT_IDS.has(template)) return {};
  const pct = Number(config.discount) || 0;
  return { headline: pct > 0 ? `${pct}% <em>off</em> your first order` : "Join our list", masthead: "" };
}

export async function popupConfigPayload(settings, { isShopify }) {
  if (!settings || !settings.enabled) return { enabled: false };
  const shopSettings = await prisma.shopSettings.findUnique({
    where: { shop: settings.shop },
    select: { whatsappEnabled: true },
  });
  const config = settings.config || null;
  return {
    enabled: true,
    template: settings.template || "editorial",
    // The code itself is never sent to the page — it is revealed only after
    // the email is confirmed, which is the whole point of double opt-in.
    config: config ? { ...legacyFallback(config, settings.template, isShopify), ...config, offerCode: undefined } : null,
    hasOffer: popupHasOffer(config, { isShopify }),
    // Collect a WhatsApp number only when the channel is on for the workspace
    // AND the popup opted in — consent for a channel that can't send is noise.
    whatsappOptIn:
      !!shopSettings?.whatsappEnabled &&
      config?.whatsappOptIn === true &&
      !NO_WHATSAPP_TEMPLATES.has(settings.template),
    // Legacy fields — kept for any old extension build still in the wild.
    headline: settings.headline,
    bodyText: settings.bodyText,
    buttonText: settings.buttonText,
    brandColor: settings.brandColor,
    logoUrl: settings.logoUrl,
    discountPct: config?.discount ?? settings.discountPct,
    delayMs: settings.delayMs,
  };
}
