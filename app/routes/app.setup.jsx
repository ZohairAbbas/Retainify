import { useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import { resolveFrom, resolveProvider, validateReplyTo } from "../lib/email/index.server.js";
import { canUseDomainSlot } from "../lib/email/domain-slots.server.js";
import { addDomain, verifyOrCheckDomain, removeDomain } from "../lib/email/domain-actions.server.js";
import Icons from "../components/ui/Icons.jsx";
import OnboardingChecklist from "../components/onboarding/OnboardingChecklist.jsx";
import { themeEditorEmbedUrl } from "../lib/onboarding/tasks.js";
import {
  getOnboardingState,
  setTaskState,
} from "../lib/onboarding/onboarding.server.js";

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;

  const state = await getOnboardingState(shop);

  const provider = resolveProvider(state.settings);
  const { from } = resolveFrom({ settings: state.settings, provider });
  const sendingFromAddress = from.match(/<([^>]+)>/)?.[1] || from;

  const slotAvailable = await canUseDomainSlot(shop);
  const contactCount = state.kind === "direct"
    ? await prisma.contact.count({ where: { shop } })
    : 0;
  let domainRecords = [];
  try {
    domainRecords = state.settings?.domainRecords ? JSON.parse(state.settings.domainRecords) : [];
  } catch {
    domainRecords = [];
  }

  return {
    shop,
    kind: state.kind,
    contactCount,
    slotAvailable,
    domainRecords,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    callUrl: process.env.ONBOARDING_CALL_URL || "#",
    sendingFromAddress,
    storeName: state.settings?.senderName && state.settings.senderName !== "Your Store"
      ? state.settings.senderName
      : ctx.account?.name || shop.replace(".myshopify.com", ""),
    settings: state.settings ?? {},
    done: state.done,
    skipped: state.skipped,
    setupComplete: state.setupComplete,
  };
};

// Same action contract as onboarding — the shared checklist submits here when
// mounted on this route.
export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "save-sender") {
    // senderEmail is intentionally NOT written — not merchant-editable.
    const senderName = String(fd.get("senderName") || "").trim();
    // Mirrors app.onboarding.jsx — the shared SenderPanel submits to whichever
    // of the two routes it is mounted on, so both need the same gate.
    const reply = validateReplyTo(fd.get("replyTo"));
    if (!reply.ok) return { ok: false, fieldError: reply.error };
    const replyTo = reply.value;
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, senderName, replyTo },
      update: { senderName, replyTo },
    });
    return { ok: true };
  }

  // Custom sending-domain step. These intents existed only on the onboarding
  // route, so the same panel rendered here could never add or verify a domain.
  if (intent === "add-domain") {
    return addDomain(shop, fd.get("domain"));
  }
  if (intent === "verify-domain" || intent === "check-domain") {
    return verifyOrCheckDomain(shop, { verify: intent === "verify-domain" });
  }
  if (intent === "remove-domain") {
    return removeDomain(shop);
  }

  if (intent === "complete-task") {
    await setTaskState(shop, String(fd.get("taskId") || ""), "complete");
    return { ok: true };
  }

  if (intent === "skip-task") {
    await setTaskState(shop, String(fd.get("taskId") || ""), "skip");
    return { ok: true };
  }

  return { ok: false };
};

export default function SetupGuide() {
  const data = useLoaderData();
  const { shop, apiKey, callUrl, storeName, done, skipped, setupComplete, kind } = data;
  const location = useLocation();
  const navigate = useNavigate();

  const ctx = {
    shop,
    storeName,
    senderName: data.settings.senderName === "Your Store" ? "" : data.settings.senderName,
    sendingFromAddress: data.sendingFromAddress,
    replyTo: data.settings.replyTo || "",
    themeEditorUrl: themeEditorEmbedUrl(shop, apiKey),
    callUrl,
    search: location.search,
    // Custom-domain step context, mirroring app.onboarding.jsx.
    domainVerified: !!data.settings.domainVerified,
    verifiedDomain: data.settings.verifiedDomain || "",
    domainStatus: data.settings.domainStatus || "",
    domainRecords: data.domainRecords || [],
    slotAvailable: data.slotAvailable,
    contactCount: data.contactCount,
  };

  const remaining = Object.keys(done).filter((id) => !done[id] && !skipped[id]).length;

  return (
    <div className="rt-page">
      {setupComplete ? (
        <div className="ob-guide-done">
          <div className="ob-live-badge"><Icons.Sparkles size={34} /></div>
          <h2>You&apos;re all set</h2>
          <p>Every setup step is complete. You can revisit any of these anytime from Settings.</p>
          <div className="ob-panel-actions" style={{ justifyContent: "center", marginTop: 24 }}>
            <button className="ob-btn ob-btn-primary" onClick={() => navigate(`/app${location.search}`)}>
              Go to dashboard <Icons.Arrow size={15} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="ob-guide-head">
            <h1>Setup guide</h1>
            <p>{remaining} {remaining === 1 ? "step" : "steps"} left to get the most out of Retainify.</p>
          </div>
          <OnboardingChecklist
            state={{ done, skipped }}
            ctx={ctx}
            variant="setup"
            kind={kind}
          />
        </>
      )}
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
