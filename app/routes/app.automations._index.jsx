import { useLoaderData, useNavigate, useLocation, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { publishJourney, pauseJourney } from "../lib/journey/journey-lifecycle.server.js";

const TRIGGER_LABELS = {
  customer_created: "New customer",
  cart_abandoned: "Cart abandoned",
  order_placed: "Order placed",
  win_back: "Win-back (90 days inactive)",
};

const STATUS_TONE = {
  draft: { label: "Draft", bg: "#f1f8fd", color: "#005c8a" },
  published: { label: "Active", bg: "#e6f3ec", color: "#0c5132" },
  paused: { label: "Paused", bg: "#fdf4e6", color: "#b25d00" },
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const journeys = await prisma.journey.findMany({
    where: { shop, archivedAt: null },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, where: { nodeType: "email" } },
      _count: { select: { enrollments: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sentCounts = await prisma.journeyJob.groupBy({
    by: ["enrollmentId"],
    where: { shop, sentAt: { gte: thirtyDaysAgo }, status: "done" },
    _count: true,
  });
  const enrollments = sentCounts.length
    ? await prisma.journeyEnrollment.findMany({
        where: { id: { in: sentCounts.map((r) => r.enrollmentId) } },
        select: { id: true, journeyId: true },
      })
    : [];
  const sentByJourney = {};
  for (const row of sentCounts) {
    const enrollment = enrollments.find((e) => e.id === row.enrollmentId);
    if (enrollment) {
      sentByJourney[enrollment.journeyId] = (sentByJourney[enrollment.journeyId] || 0) + row._count;
    }
  }

  return {
    journeys: journeys.map((j) => ({
      ...j,
      sentLast30: sentByJourney[j.id] || 0,
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const journeyId = String(fd.get("journeyId") || "");

  const journey = await prisma.journey.findFirst({ where: { id: journeyId, shop } });
  if (!journey) return { ok: false };

  if (intent === "toggle-active") {
    if (journey.status === "published") await pauseJourney(journeyId);
    else await publishJourney(journeyId);
    return { ok: true };
  }
  return { ok: false };
};

export default function Automations() {
  const { journeys } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher();

  function toggle(id) {
    fetcher.submit({ intent: "toggle-active", journeyId: id }, { method: "post" });
  }

  return (
    <s-page heading="Automations">
      <div style={{
        marginBottom: 12, display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 16,
      }}>
        <div style={{ fontSize: 13, color: "#6d7175" }}>
          Simple form-based editor for your flows. For the full visual builder, use{" "}
          <a
            href={`/app/flows${location.search}`}
            style={{ color: "#005c8a", textDecoration: "none" }}
          >Flows</a>.
        </div>
        <s-button variant="primary" onClick={() => navigate(`/app/flows${location.search}`)}>
          Create Flow
        </s-button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {journeys.map((j) => {
          const tone = STATUS_TONE[j.status] || STATUS_TONE.draft;
          return (
            <s-section key={j.id}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>{j.name}</span>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 12,
                      background: tone.bg, color: tone.color, fontSize: 11, fontWeight: 500,
                    }}>{tone.label}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#6d7175" }}>
                    {TRIGGER_LABELS[j.trigger] || j.trigger} · {j.steps.length} emails · {j.sentLast30} sent (last 30 days)
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <ToggleSwitch
                    checked={j.status === "published"}
                    onChange={() => toggle(j.id)}
                    disabled={fetcher.state !== "idle"}
                  />
                  <s-button onClick={() => navigate(`/app/automations/${j.id}${location.search}`)}>
                    Edit
                  </s-button>
                </div>
              </div>
            </s-section>
          );
        })}

        {journeys.length === 0 && (
          <s-section>
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#6d7175" }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: "#202223" }}>
                No automations yet
              </div>
              <div style={{ fontSize: 13 }}>
                Visit Flows to create your first automation from a template.
              </div>
              <div style={{ marginTop: 16 }}>
                <s-button onClick={() => navigate(`/app/flows${location.search}`)}>
                  Go to Flows
                </s-button>
              </div>
            </div>
          </s-section>
        )}
      </div>
    </s-page>
  );
}

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: checked ? "#0c5132" : "#c9cccf",
        border: "none", position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s",
        opacity: disabled ? 0.6 : 1, padding: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: "50%", background: "#fff",
        transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      }} />
    </button>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
