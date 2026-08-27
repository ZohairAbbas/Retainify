import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import { PUBLIC_PLANS, formatLimit, isUnlimited } from "../lib/billing/plans.js";
import { getUsageSummary } from "../lib/billing/entitlements.server.js";
import {
  planSelectionUrl,
  planHandleFromRequest,
  billingProviderFor,
  billingContactEmail,
  BILLING_SHOPIFY,
} from "../lib/billing/plan-url.server.js";

const FEATURE_ROWS = [
  { key: "contacts", label: "Billable contacts", kind: "limit" },
  { key: "emails", label: "Emails per month", kind: "limit" },
  { key: "popup", label: "Popup", kind: "always" },
  { key: "push", label: "Web push", kind: "always" },
  { key: "segments", label: "Segments", kind: "limit" },
  { key: "flows", label: "Flows", kind: "limit" },
  {
    key: "custom_domain",
    label: "Custom sending domain",
    kind: "feature",
    note: "Subject to availability",
  },
  { key: "whatsapp", label: "WhatsApp", kind: "feature" },
  { key: "no_branding", label: "Retainify branding removed", kind: "feature" },
];

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;

  // Both workspace kinds see this page. Usage, entitlements and the comparison
  // table are keyed on `shop` (the workspace key) and work identically for a
  // direct workspace; only checkout differs, which is what `provider` selects.
  const provider = billingProviderFor(ctx);

  // Subscription sync happens in the parent /app loader (app.jsx), which runs
  // for every /app/* route and therefore also catches Shopify's post-approval
  // redirect wherever it lands. No need to sync again here.
  const justUpgraded = !!planHandleFromRequest(request);

  const { entitlement, emails, contacts } = await getUsageSummary(shop);

  return {
    shop,
    justUpgraded,
    planKey: entitlement.planKey,
    isComped: entitlement.isComped,
    compedUntil: entitlement.compedUntil,
    enforced: entitlement.enforced,
    usage: {
      emails: { used: emails.used, limit: emails.limit },
      contacts: { used: contacts.used, limit: contacts.limit },
    },
    plans: PUBLIC_PLANS,
    provider,
    // Only meaningful for the Shopify provider; null keeps the client from
    // rendering a link it can't honour.
    planUrl: provider === BILLING_SHOPIFY ? planSelectionUrl(shop) : null,
    contactEmail: provider === BILLING_SHOPIFY ? "" : billingContactEmail(),
  };
};

function UsageMeter({ label, used, limit }) {
  const unlimited = isUnlimited(limit);
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const over = !unlimited && used > limit;

  return (
    <div className="rt-stat">
      <div className="t-micro muted">{label}</div>
      <div className="t-display-2 t-mono" style={{ lineHeight: 1, margin: 0 }}>
        {used.toLocaleString()}
        <span className="rt-stat-unit">/ {formatLimit(limit)}</span>
      </div>
      {!unlimited && (
        <div
          style={{
            height: 4,
            background: "var(--hair-1)",
            borderRadius: 2,
            overflow: "hidden",
            marginTop: 8,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: over ? "var(--danger, #b42318)" : "var(--brand-700)",
            }}
          />
        </div>
      )}
    </div>
  );
}

function cellFor(plan, row) {
  if (row.kind === "always") return "✓";
  if (row.kind === "feature") return plan.features.includes(row.key) ? "✓" : "—";
  return formatLimit(plan.limits[row.key]);
}

/**
 * How a workspace changes plan. One branch per billing provider — a future
 * "stripe" case slots in here beside these two and touches nothing else.
 */
function PlanCta({ provider, planUrl, planKey, contactEmail }) {
  if (provider === "shopify") {
    return (
      <>
        {/* Shopify hosts the plan picker and owns the checkout. target="_top"
            is required — the admin cannot render inside our embedded iframe. */}
        <a
          className="btn btn-primary"
          href={planUrl}
          target="_top"
          rel="noopener noreferrer"
        >
          {planKey === "free" ? "Choose a plan" : "Change plan"}
        </a>
        <div className="t-small muted" style={{ marginTop: 10 }}>
          Plans, billing and cancellation are handled by Shopify and appear on your Shopify invoice.
        </div>
      </>
    );
  }

  // BILLING_NONE — no self-serve checkout for web workspaces yet.
  return (
    <div className="t-small muted">
      To change your plan, get in touch
      {contactEmail ? (
        <>
          {" at "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </>
      ) : null}
      {" — self-serve billing is coming to the web app soon."}
    </div>
  );
}

function PlansPageInner() {
  const {
    justUpgraded,
    planKey,
    isComped,
    compedUntil,
    enforced,
    usage,
    plans,
    provider,
    planUrl,
    contactEmail,
  } = useLoaderData();

  const compDate = compedUntil
    ? new Date(compedUntil).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Plans</h1>
        </div>
      </header>

      {justUpgraded && (
        <section
          className="rt-form-section"
          style={{ marginBottom: 24, borderLeft: "3px solid var(--brand-700)" }}
        >
          <div className="t-body" style={{ fontWeight: 500 }}>Your plan is active.</div>
          <div className="t-small muted" style={{ marginTop: 4 }}>
            Thanks for subscribing — everything on your plan is unlocked.
          </div>
        </section>
      )}

      {isComped && (
        <section
          className="rt-form-section"
          style={{ marginBottom: 24, borderLeft: "3px solid var(--brand-700)" }}
        >
          <div className="t-body" style={{ fontWeight: 500 }}>
            You&rsquo;re on early access — full features, no charge.
          </div>
          <div className="t-small muted" style={{ marginTop: 4 }}>
            {compDate
              ? `This runs until ${compDate}. Pick a plan before then to keep everything you're using.`
              : "Thanks for being an early Retainify store."}
          </div>
        </section>
      )}

      <div className="rt-stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <UsageMeter
          label="Emails this month"
          used={usage.emails.used}
          limit={usage.emails.limit}
        />
        <UsageMeter
          label="Billable contacts"
          used={usage.contacts.used}
          limit={usage.contacts.limit}
        />
      </div>

      {!enforced && (
        <div className="t-small muted" style={{ marginBottom: 24 }}>
          Limits aren&rsquo;t being enforced yet — you won&rsquo;t be interrupted while we finish rolling plans out.
        </div>
      )}

      <section className="rt-form-section">
        <div className="t-micro muted" style={{ marginBottom: 16 }}>Compare plans</div>

        <div style={{ overflowX: "auto" }}>
          <table
            className="t-small"
            style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 12px" }} />
                {plans.map((p) => {
                  const current = p.key === planKey;
                  return (
                    <th
                      key={p.key}
                      style={{
                        textAlign: "left",
                        padding: "8px 12px",
                        borderBottom: "1px solid var(--hair-1)",
                      }}
                    >
                      <div className="t-body" style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="t-small muted">
                        {p.price === 0 ? "Free" : `$${p.price.toFixed(2)}/mo`}
                      </div>
                      {current && (
                        <span className="pill" style={{ marginTop: 6, display: "inline-block" }}>
                          Current
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row) => (
                <tr key={row.key}>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--hair-1)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.label}
                    {row.note && (
                      <div className="t-micro muted" style={{ marginTop: 2 }}>{row.note}</div>
                    )}
                  </td>
                  {plans.map((p) => (
                    <td
                      key={p.key}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--hair-1)",
                        color: "var(--ink-2)",
                      }}
                    >
                      {cellFor(p, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 24 }}>
          <PlanCta
            provider={provider}
            planUrl={planUrl}
            planKey={planKey}
            contactEmail={contactEmail}
          />
        </div>
      </section>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

export default function PlansPage() {
  return <PlansPageInner />;
}
