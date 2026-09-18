import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import { getDefaults, mergeOnTemplateSwitch, TEMPLATES } from "../lib/popup-templates/index.js";
import { findMissingHooks } from "../lib/popup-templates/html-sanitize.js";
import PopupsPage from "../components/popups/PopupsPage.jsx";
import PopupEditor from "../components/popups/PopupEditor.jsx";
import WebsiteInstall from "../components/popups/WebsiteInstall.jsx";
import { PopupEnv } from "../lib/popup-templates/shared.jsx";
import { ensureSiteKey, parseDomains } from "../lib/popup/embed.server.js";

// Derive legacy scalar columns from the new template config. Kept in sync on every
// write so other code paths still reading from PopupSettings.discountPct etc. (e.g.
// track.confirm.jsx, email rendering) see fresh values.
function configToLegacy(config) {
  const discount = Number.isFinite(config?.discount) ? config.discount : 10;
  const delaySec = parseInt(config?.delay ?? "3", 10);
  return {
    headline: String(config?.headline ?? "Wait — don't go yet!"),
    bodyText: String(config?.body ?? ""),
    buttonText: String(config?.cta ?? "Get my discount"),
    discountPct: discount,
    delayMs: Math.max(0, isNaN(delaySec) ? 3 : delaySec) * 1000,
  };
}

function legacyToConfig(row) {
  return {
    template: row.template || "editorial",
    masthead: "YOUR BRAND",
    headline: row.headline,
    body: row.bodyText,
    cta: row.buttonText,
    placeholder: "your address",
    fine: "By subscribing you agree to receive marketing emails. Unsubscribe anytime.",
    image: "amber",
    accent: "burgundy",
    discount: row.discountPct,
    trigger: "delay",
    delay: String(Math.max(0, Math.floor((row.delayMs ?? 3000) / 1000))),
    frequency: "session",
  };
}

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop, isShopify } = ctx;

  // A website outside Shopify installs the popup with a script tag, which
  // needs a site key before there is anything to copy.
  if (!isShopify) await ensureSiteKey(shop);
  const row = await prisma.popupSettings.findUnique({ where: { shop } });

  // "Subscribers" used to be a raw count of every popup signup row, including
  // the ones that never confirmed — which, under double opt-in, are not
  // subscribers. Splitting the numbers says what each one actually is.
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [total, confirmed, last30] = await Promise.all([
    prisma.popupSignup.count({ where: { shop } }),
    prisma.popupSignup.count({ where: { shop, confirmedAt: { not: null } } }),
    prisma.popupSignup.count({ where: { shop, createdAt: { gte: since30 } } }),
  ]);
  const signupCount = { total, confirmed, last30 };
  const storeDomain = isShopify
    ? shop.replace(".myshopify.com", "")
    : row?.siteDomains?.[0] || "your-website.com";
  // The merchant's own name for their store, for the preview chrome.
  const shopSettings = await prisma.shopSettings.findUnique({
    where: { shop },
    select: { senderName: true },
  });
  const storeName =
    shopSettings?.senderName && shopSettings.senderName !== "Your Store"
      ? shopSettings.senderName
      : storeDomain;

  // eslint-disable-next-line no-undef
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const embed = isShopify
    ? null
    : {
        siteKey: row?.siteKey || "",
        domains: row?.siteDomains || [],
        lastSeenAt: row?.lastSeenAt || null,
        lastSeenOrigin: row?.lastSeenOrigin || "",
        scriptUrl: `${appUrl}/embed/popup.js`,
      };

  // A row can exist with no popup chosen yet (the site key is created first).
  if (!row || !row.config) {
    return { popup: row ? { enabled: row.enabled, template: null, config: null } : null, signupCount, storeDomain, storeName, isShopify, embed };
  }

  const config = row.config ?? legacyToConfig(row);

  return {
    popup: {
      enabled: row.enabled,
      template: row.template || "editorial",
      config,
    },
    signupCount,
    storeDomain,
    storeName,
    isShopify,
    embed,
  };
};

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-domains") {
    if (ctx.isShopify) return { ok: false, error: "Shopify stores install the popup through the theme embed." };
    const { domains, invalid, truncated } = parseDomains(formData.get("domains"));
    if (invalid.length) {
      return { ok: false, domainsError: `Not a website domain: ${invalid.slice(0, 3).join(", ")}. Use just the address, like yourstore.com.` };
    }
    await ensureSiteKey(shop);
    await prisma.popupSettings.update({ where: { shop }, data: { siteDomains: domains } });
    return { ok: true, domainsSaved: true, truncated };
  }

  if (intent === "toggle-enabled") {
    const current = await prisma.popupSettings.findUnique({ where: { shop } });
    // A website starts from the newsletter popup: it promises no discount,
    // which a site without Shopify can only give with a code of its own.
    const defaults = getDefaults(ctx.isShopify ? "editorial" : "newsletter");
    await prisma.popupSettings.upsert({
      where: { shop },
      create: {
        shop,
        enabled: true,
        template: defaults.template,
        config: defaults,
        ...configToLegacy(defaults),
      },
      // Turning on a row that has no popup chosen yet gives it the default.
      update: current?.config
        ? { enabled: !current.enabled }
        : { enabled: true, template: defaults.template, config: defaults, ...configToLegacy(defaults) },
    });
    return { ok: true, toggled: true };
  }

  if (intent === "use-template") {
    const template = String(formData.get("template") || "editorial");
    if (!TEMPLATES[template]) return { ok: false, error: "unknown_template" };

    const current = await prisma.popupSettings.findUnique({ where: { shop } });
    const currentConfig = current?.config ?? (current ? legacyToConfig(current) : null);
    const config = currentConfig
      ? mergeOnTemplateSwitch(currentConfig, template)
      : getDefaults(template);
    const legacy = configToLegacy(config);

    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, enabled: true, template, config, ...legacy },
      update: { template, config, ...legacy },
    });
    return { ok: true, template };
  }

  if (intent === "save-popup") {
    const template = String(formData.get("template") || "editorial");
    if (!TEMPLATES[template]) return { ok: false, error: "unknown_template" };

    const configRaw = formData.get("config");
    let config;
    try {
      config = JSON.parse(String(configRaw || "{}"));
    } catch {
      return { ok: false, error: "invalid_config_json" };
    }
    config.template = template;

    // Custom HTML must include the email-capture hooks. Client blocks the Save
    // button when hooks are missing, but re-validate on the server so a crafted
    // request can't bypass it.
    if (template === "custom") {
      const missing = findMissingHooks(config.html || "");
      if (missing.length > 0) {
        return { ok: false, error: "missing_hooks", missing };
      }
    }

    const legacy = configToLegacy(config);
    if (config.offerCode !== undefined) config.offerCode = String(config.offerCode || "").trim().slice(0, 64);

    // The first popup ever saved goes live. A website's row exists before
    // that (it holds the site key) but starts paused, and saving a popup is
    // the moment the merchant has something to show.
    const existing = await prisma.popupSettings.findUnique({ where: { shop }, select: { config: true } });
    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, enabled: true, template, config, ...legacy },
      update: { template, config, ...legacy, ...(existing && !existing.config ? { enabled: true } : {}) },
    });
    return { ok: true, saved: true };
  }

  return { ok: false };
};

function PopupRouteInner() {
  const { popup, signupCount, storeDomain, storeName, isShopify = true, embed } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();

  const mode = searchParams.get("mode");
  const isEditing = mode === "edit";
  const saving = fetcher.state !== "idle";

  function enterEditor(templateId) {
    const next = new URLSearchParams(searchParams);
    next.set("mode", "edit");
    if (templateId) next.set("template", templateId);
    setSearchParams(next);
  }

  function exitEditor() {
    const next = new URLSearchParams(searchParams);
    next.delete("mode");
    next.delete("template");
    setSearchParams(next);
  }

  function handleToggle() {
    toggleFetcher.submit({ intent: "toggle-enabled" }, { method: "post" });
  }

  // Clicking a gallery card is purely a navigation action — it opens the
  // editor with the picked template. Nothing is persisted until Save.
  // Cancel/Back leaves the currently-saved popup untouched.
  function handleUseTemplate(templateId) {
    enterEditor(templateId);
  }

  function handleSave(draft) {
    const { template, ...rest } = draft;
    fetcher.submit(
      { intent: "save-popup", template, config: JSON.stringify({ ...rest, template }) },
      { method: "post" },
    );
  }

  function handleSwitchTemplate(newTemplateId, currentDraft) {
    return mergeOnTemplateSwitch(currentDraft, newTemplateId);
  }

  if (isEditing) {
    const editingTemplate = searchParams.get("template") || popup?.template || "editorial";
    const initialDraft =
      popup && popup.template === editingTemplate && popup.config
        ? { ...popup.config, template: editingTemplate }
        : { ...getDefaults(editingTemplate), template: editingTemplate };

    return (
      <PopupEnv.Provider value={{ isShopify }}>
      <PopupEditor
        storeDomain={storeDomain}
        storeName={storeName}
        initialDraft={initialDraft}
        saving={saving}
        onSave={(draft) => {
          handleSave(draft);
          exitEditor();
        }}
        onCancel={exitEditor}
        onSwitchTemplate={handleSwitchTemplate}
      />
      </PopupEnv.Provider>
    );
  }

  return (
    <PopupsPage
      popup={popup}
      signupCount={signupCount}
      storeDomain={storeDomain}
      storeName={storeName}
      isShopify={isShopify}
      install={embed ? <WebsiteInstall embed={embed} popup={popup} /> : null}
      onEnterEditor={enterEditor}
      onToggle={handleToggle}
      onUseTemplate={handleUseTemplate}
    />
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

export default function PopupRoute() {
  return <PopupRouteInner />;
}
