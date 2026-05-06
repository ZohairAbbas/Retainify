import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  return { settings: settings ?? {} };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-settings") {
    const senderName = String(formData.get("senderName") || "").trim();
    const senderEmail = String(formData.get("senderEmail") || "").trim();
    const replyTo = String(formData.get("replyTo") || "").trim();
    const brandColor = String(formData.get("brandColor") || "#000000").trim();
    const logoUrl = String(formData.get("logoUrl") || "").trim();
    const quietHoursStart = parseInt(formData.get("quietHoursStart") || "22", 10);
    const quietHoursEnd = parseInt(formData.get("quietHoursEnd") || "8", 10);
    const storeTimezone = String(formData.get("storeTimezone") || "UTC").trim();

    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, senderName, senderEmail, replyTo, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone },
      update: { senderName, senderEmail, replyTo, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone },
    });
    return { ok: true, saved: true };
  }

  return { ok: false };
};

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  label: `${i.toString().padStart(2, "0")}:00`,
  value: String(i),
}));

export default function Settings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.saved;

  const [senderName, setSenderName] = useState(settings.senderName || "");
  const [senderEmail, setSenderEmail] = useState(settings.senderEmail || "");
  const [replyTo, setReplyTo] = useState(settings.replyTo || "");
  const [brandColor, setBrandColor] = useState(settings.brandColor || "#000000");
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");
  const [quietHoursStart, setQuietHoursStart] = useState(String(settings.quietHoursStart ?? "22"));
  const [quietHoursEnd, setQuietHoursEnd] = useState(String(settings.quietHoursEnd ?? "8"));
  const [storeTimezone, setStoreTimezone] = useState(settings.storeTimezone || "UTC");

  function saveSettings() {
    fetcher.submit(
      {
        intent: "save-settings",
        senderName,
        senderEmail,
        replyTo,
        brandColor,
        logoUrl,
        quietHoursStart,
        quietHoursEnd,
        storeTimezone,
      },
      { method: "post" },
    );
  }

  return (
    <s-page heading="Settings">
      <s-section heading="Sender details">
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
          />
          <s-text-field
            label="Reply-to email"
            type="email"
            value={replyTo}
            onInput={(e) => setReplyTo(e.target.value)}
            placeholder="support@yourstore.com"
          />
        </s-form-layout>
      </s-section>

      <s-section heading="Brand">
        <s-form-layout>
          <s-text-field
            label="Brand color"
            value={brandColor}
            onInput={(e) => setBrandColor(e.target.value)}
            placeholder="#000000"
            helpText="Hex color used for buttons and accents in emails."
          />
          <s-text-field
            label="Logo URL"
            value={logoUrl}
            onInput={(e) => setLogoUrl(e.target.value)}
            placeholder="https://yourstore.com/logo.png"
            helpText="Shown at the top of every recovery email."
          />
        </s-form-layout>
      </s-section>

      <s-section heading="Quiet hours">
        <s-text tone="subdued">Emails will not be sent during this window.</s-text>
        <s-form-layout>
          <s-select
            label="Start (don't send after)"
            options={JSON.stringify(HOURS)}
            value={quietHoursStart}
            onChange={(e) => setQuietHoursStart(e.detail?.value ?? e.target?.value ?? quietHoursStart)}
          />
          <s-select
            label="End (resume sending after)"
            options={JSON.stringify(HOURS)}
            value={quietHoursEnd}
            onChange={(e) => setQuietHoursEnd(e.detail?.value ?? e.target?.value ?? quietHoursEnd)}
          />
          <s-text-field
            label="Store timezone"
            value={storeTimezone}
            onInput={(e) => setStoreTimezone(e.target.value)}
            placeholder="Asia/Karachi"
            helpText="IANA timezone e.g. Asia/Dubai, Asia/Kolkata, America/New_York"
          />
        </s-form-layout>
      </s-section>

      <div style={{ marginTop: "20px" }}>
        <s-page-actions>
          <s-button
            slot="primaryAction"
            onClick={saveSettings}
            {...(saving ? { loading: true } : {})}
          >
            {saved ? "Saved!" : "Save settings"}
          </s-button>
        </s-page-actions>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
