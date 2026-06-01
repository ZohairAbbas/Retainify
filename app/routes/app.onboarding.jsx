import { useState } from "react";
import { useLoaderData, useFetcher, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  return {
    shop,
    step: settings?.onboardingStep ?? 0,
    settings: settings ?? {},
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-step-1") {
    const senderName = String(formData.get("senderName") || "").trim();
    const senderEmail = String(formData.get("senderEmail") || "").trim();
    const replyTo = String(formData.get("replyTo") || "").trim();

    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, senderName, senderEmail, replyTo, onboardingStep: 1 },
      update: { senderName, senderEmail, replyTo, onboardingStep: 1 },
    });
    return { ok: true, step: 1 };
  }

  if (intent === "activate") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { onboardingStep: 2, isActive: true },
    });
    return { ok: true, step: 2 };
  }

  return { ok: false };
};

export default function Onboarding() {
  const { shop, step, settings, apiKey } = useLoaderData();
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps&template=index&activateAppId=${apiKey}/popup`;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();
  const saving = fetcher.state !== "idle";
  const data = fetcher.data;

  const currentStep = data?.step ?? step;

  // Step 1 state
  const [senderName, setSenderName] = useState(settings.senderName || "");
  const [senderEmail, setSenderEmail] = useState(settings.senderEmail || "");
  const [replyTo, setReplyTo] = useState(settings.replyTo || "");

  function submitStep1() {
    fetcher.submit(
      { intent: "save-step-1", senderName, senderEmail, replyTo },
      { method: "post" },
    );
  }

  function submitActivate() {
    fetcher.submit({ intent: "activate" }, { method: "post" });
  }

  if (currentStep >= 2) {
    return (
      <s-page heading="You're all set!">
        <s-section>
          <s-stack direction="block" gap="base" align="center">
            <s-text variant="headingLg">Retainify is live 🎉</s-text>
            <s-paragraph>
              You can now build cart-rescue, post-purchase, and other automations in Flows.
            </s-paragraph>
            <s-button onClick={() => navigate(`/app${location.search}`)}>Go to dashboard</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Set up Retainify">
      <s-section heading={`Step ${currentStep + 1} of 2`}>

        {/* Step 1 — Sender details */}
        {currentStep === 0 && (
          <s-stack direction="block" gap="base">
            <s-text variant="headingMd">Configure your sender details</s-text>
            <s-text tone="subdued">These appear as the "From" name and address in emails.</s-text>
            <s-form-layout>
              <s-text-field
                label="Sender name"
                value={senderName}
                onInput={(e) => setSenderName(e.target.value)}
                placeholder="Your Store"
                helpText="Shown as the From name in emails."
              />
              <s-text-field
                label="Sender email"
                type="email"
                value={senderEmail}
                onInput={(e) => setSenderEmail(e.target.value)}
                placeholder="hello@yourstore.com"
                helpText="Use your store email or a verified domain."
              />
              <s-text-field
                label="Reply-to email (optional)"
                type="email"
                value={replyTo}
                onInput={(e) => setReplyTo(e.target.value)}
                placeholder="support@yourstore.com"
              />
            </s-form-layout>
            <s-button
              onClick={submitStep1}
              {...(saving ? { loading: true } : {})}
            >
              Continue
            </s-button>
          </s-stack>
        )}

        {/* Step 2 — Activate */}
        {currentStep === 1 && (
          <s-stack direction="block" gap="base">
            <s-text variant="headingMd">Enable the popup on your storefront</s-text>
            <s-paragraph>
              The exit-intent popup is an app embed and needs to be turned on in your theme editor.
              Click below to open the editor — the Retainify embed will be highlighted, then click
              <strong> Save</strong> in the top-right.
            </s-paragraph>
            <s-button
              href={themeEditorUrl}
              target="_blank"
            >
              Open theme editor to enable popup
            </s-button>

            <s-divider />

            <s-paragraph>
              Once the popup is enabled, activate Retainify to start running your flows.
              You can build cart-rescue, post-purchase, and other automations from the Flows page.
            </s-paragraph>
            <s-button
              tone="success"
              onClick={submitActivate}
              {...(saving ? { loading: true } : {})}
            >
              Activate Retainify
            </s-button>
          </s-stack>
        )}

      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
