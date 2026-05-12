import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

const TRIGGER_LABELS = {
  customer_created: "New customer",
  order_placed: "Order placed",
  win_back: "Win-back (90 days inactive)",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const journeys = await prisma.journey.findMany({
    where: { shop },
    include: {
      steps: { orderBy: { stepNumber: "asc" } },
      _count: { select: { enrollments: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Email sent counts per journey (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sentCounts = await prisma.journeyJob.groupBy({
    by: ["enrollmentId"],
    where: {
      shop,
      sentAt: { gte: thirtyDaysAgo },
      status: "done",
    },
    _count: true,
  });

  // Map enrollmentId → journeyId for counts
  const enrollmentIds = sentCounts.map((r) => r.enrollmentId);
  const enrollments = enrollmentIds.length
    ? await prisma.journeyEnrollment.findMany({
        where: { id: { in: enrollmentIds } },
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
  const formData = await request.formData();
  const intent = formData.get("intent");
  const journeyId = String(formData.get("journeyId") || "");

  if (intent === "toggle-active") {
    const journey = await prisma.journey.findFirst({ where: { id: journeyId, shop } });
    if (!journey) return { ok: false };
    await prisma.journey.update({
      where: { id: journeyId },
      data: { isActive: !journey.isActive },
    });
    return { ok: true };
  }

  return { ok: false };
};

export default function Playbooks() {
  const { journeys } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  function toggleActive(journeyId) {
    fetcher.submit({ intent: "toggle-active", journeyId }, { method: "post" });
  }

  return (
    <s-page heading="Playbooks">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {journeys.map((journey) => (
          <s-section key={journey.id}>
            <s-stack direction="inline" gap="base" align="center" justify="space-between">
              <s-stack direction="block" gap="tight">
                <s-text variant="headingSm">{journey.name}</s-text>
                <s-text tone="subdued" variant="bodySm">
                  {TRIGGER_LABELS[journey.trigger] || journey.trigger} · {journey.steps.length} emails ·{" "}
                  {journey.sentLast30} sent (last 30 days)
                </s-text>
              </s-stack>
              <s-stack direction="inline" gap="base" align="center">
                <ToggleSwitch
                  checked={journey.isActive}
                  onChange={() => toggleActive(journey.id)}
                  disabled={fetcher.state !== "idle"}
                />
                <s-button
                  onClick={() => navigate(`/app/playbooks/${journey.id}${window.location.search}`)}
                >
                  Edit
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        ))}

        {journeys.length === 0 && (
          <s-section>
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#6d7175" }}>
              <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "6px", color: "#202223" }}>
                No playbooks yet
              </div>
              <div style={{ fontSize: "13px" }}>
                Visit the Dashboard to seed default playbooks for your store.
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
        width: "44px", height: "24px", borderRadius: "12px",
        background: checked ? "#0c5132" : "#c9cccf",
        border: "none", position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s",
        opacity: disabled ? 0.6 : 1,
        padding: 0,
      }}
    >
      <span style={{
        position: "absolute", top: "2px",
        left: checked ? "22px" : "2px",
        width: "20px", height: "20px",
        borderRadius: "50%", background: "#fff",
        transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      }} />
    </button>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
