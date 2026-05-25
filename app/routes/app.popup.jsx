import { useNavigate, useLoaderData, useFetcher, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { getDefaults, mergeOnTemplateSwitch, TEMPLATES } from "../lib/popup-templates/index.js";
import PopupsPage from "../components/popups/PopupsPage.jsx";
import PopupEditor from "../components/popups/PopupEditor.jsx";

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
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const row = await prisma.popupSettings.findUnique({ where: { shop } });
  const signupCount = await prisma.popupSignup.count({ where: { shop } });

  if (!row) {
    return { popup: null, signupCount };
  }

  const config = row.config ?? legacyToConfig(row);

  return {
    popup: {
      enabled: row.enabled,
      template: row.template || "editorial",
      config,
    },
    signupCount,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-enabled") {
    const current = await prisma.popupSettings.findUnique({ where: { shop } });
    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, enabled: true, template: "editorial", config: getDefaults("editorial") },
      update: { enabled: !current?.enabled },
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

    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, enabled: true, template, config },
      update: { template, config },
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

    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, enabled: true, template, config },
      update: { template, config },
    });
    return { ok: true, saved: true };
  }

  return { ok: false };
};

export default function PopupRoute() {
  const { popup, signupCount } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();
  const navigate = useNavigate();

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

  function handleUseTemplate(templateId) {
    fetcher.submit({ intent: "use-template", template: templateId }, { method: "post" });
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
      <PopupEditor
        initialDraft={initialDraft}
        saving={saving}
        onSave={(draft) => {
          handleSave(draft);
          exitEditor();
        }}
        onCancel={exitEditor}
        onSwitchTemplate={handleSwitchTemplate}
      />
    );
  }

  return (
    <PopupsPage
      popup={popup}
      signupCount={signupCount}
      onEnterEditor={enterEditor}
      onToggle={handleToggle}
      onUseTemplate={handleUseTemplate}
    />
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
