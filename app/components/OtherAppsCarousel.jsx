import { useState } from "react";

export const GROWZAR_APPS = [
  {
    handle: "courierify",
    name: "Courierify: Courier Management",
    icon: "https://cdn.shopify.com/app-store/listing_images/cef2dfeb2aaeba9ca1213237d3b2feb5/icon/CO6byoT20ZMDEAE=.png",
    description:
      "Pakistan's most integrated courier management platform for Shopify — book, track, reconcile settlements, and automate customer comms.",
    badge: "New App",
  },
  {
    handle: "financify",
    name: "Financify: COD Profit Analytics",
    icon: "https://cdn.shopify.com/app-store/listing_images/6ca373e1b5889258e7f06f760041448f/icon/CKP0lMOK7I8DEAE=.jpeg",
    description:
      "Real-time, COD-first profit analytics. Track delivery fees, returns, ad spend, and operating costs in one place to know your true margins.",
    badge: "New App",
  },
  {
    handle: "whatkabot",
    name: "WhatKaBot: AI Support + Reviews",
    icon: "https://cdn.shopify.com/app-store/listing_images/d6462912a6286be7143dc307c62a02b5/icon/CJL4nZSXjJQDEAE=.png",
    description:
      "Collect authentic customer reviews over WhatsApp with interactive polls and media uploads, plus AI-powered support on the channel customers prefer.",
    badge: "New App",
  },
  {
    handle: "retainify",
    name: "Retainify — Cart Recovery",
    icon: "https://cdn.shopify.com/app-store/listing_images/772b207205dcd34f8f3eb724972869cc/icon/CI7btqjjpJQDEAE=.png",
    description:
      "Win back abandoned carts with automated, branded recovery emails and exit-intent popups that recapture lost sales on autopilot.",
    badge: "New App",
  },
  {
    handle: "preventify",
    name: "Preventify: COD Form & Upsells",
    icon: "https://cdn.shopify.com/app-store/listing_images/8908d85f0ad3249746e4614bdba226d8/icon/CN6g4fSB0pMDEAE=.png",
    description:
      "Build a 1-click COD order form with pre- and post-purchase upsells, downsells, and OTP fraud prevention to boost conversions and AOV.",
    badge: "New App",
  },
];

export function OtherAppsCarousel({
  currentHandle,
  apps = GROWZAR_APPS,
  utmSource,
}) {
  const list = apps.filter((a) => a.handle !== currentHandle);
  const [index, setIndex] = useState(0);
  if (list.length === 0) return null;

  const app = list[index];
  const total = list.length;
  const go = (d) => setIndex((p) => (p + d + total) % total);
  const utm = utmSource || currentHandle;

  return (
    <div
      style={{
        background: "var(--paper-3)",
        border: "1px solid var(--hair-1)",
        borderRadius: "var(--r-3)",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <img
            src={app.icon}
            alt={`${app.name} app icon`}
            width={48}
            height={48}
            style={{ borderRadius: "var(--r-2)", border: "1px solid var(--hair-1)", display: "block" }}
          />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>{app.name}</div>
          {app.badge && (
            <span
              style={{
                background: "var(--accent)",
                color: "var(--accent-ink, var(--brand-ink))",
                border: "1px solid var(--accent-deep)",
                borderRadius: "var(--r-2)",
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {app.badge}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {total > 1 && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                aria-label="Previous app"
                onClick={() => go(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                aria-label="Next app"
                onClick={() => go(1)}
              >
                ›
              </button>
            </>
          )}
          <a
            className="btn btn-primary"
            href={`https://apps.shopify.com/${app.handle}?utm_source=${utm}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${app.name}`}
          >
            View App
          </a>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {app.description}
      </p>
    </div>
  );
}
