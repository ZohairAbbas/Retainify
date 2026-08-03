import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { resolveFrom, resolveProvider } from "../lib/email/index.server.js";
import Icons from "../components/ui/Icons.jsx";
import OnboardingChecklist from "../components/onboarding/OnboardingChecklist.jsx";
import { TASKS, themeEditorEmbedUrl } from "../lib/onboarding/tasks.js";
import {
  getOnboardingState,
  setTaskState,
} from "../lib/onboarding/onboarding.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const state = await getOnboardingState(shop);

  // The real from-address this shop sends from — shown read-only, same seam the
  // send path and Settings use. Sender email is not merchant-editable.
  const provider = resolveProvider(state.settings);
  const { from } = resolveFrom({ settings: state.settings, provider });
  const sendingFromAddress = from.match(/<([^>]+)>/)?.[1] || from;

  return {
    shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    callUrl: process.env.ONBOARDING_CALL_URL || "#",
    sendingFromAddress,
    owner: session.firstName || "",
    storeName: state.settings?.senderName && state.settings.senderName !== "Your Store"
      ? state.settings.senderName
      : shop.replace(".myshopify.com", ""),
    settings: state.settings ?? {},
    done: state.done,
    skipped: state.skipped,
    essentialsDone: state.essentialsDone,
    activated: state.activated,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "save-sender") {
    // senderEmail is intentionally NOT written — it's not merchant-editable
    // (all sends use our shared from-address). Mirrors app.settings.jsx.
    const senderName = String(fd.get("senderName") || "").trim();
    const replyTo = String(fd.get("replyTo") || "").trim();
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, senderName, replyTo },
      update: { senderName, replyTo },
    });
    return { ok: true };
  }

  if (intent === "complete-task") {
    const taskId = String(fd.get("taskId") || "");
    await setTaskState(shop, taskId, "complete");
    return { ok: true };
  }

  if (intent === "skip-task") {
    const taskId = String(fd.get("taskId") || "");
    await setTaskState(shop, taskId, "skip");
    return { ok: true };
  }

  if (intent === "activate") {
    // Only allow activation once the essentials are actually resolved.
    const state = await getOnboardingState(shop);
    if (!state.essentialsDone) {
      return { ok: false, error: "essentials-incomplete" };
    }
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, onboardingStep: 2, isActive: true },
      update: { onboardingStep: 2, isActive: true },
    });
    return { ok: true, activated: true };
  }

  return { ok: false };
};

// ── Welcome takeover ───────────────────────────────────────────────────
function Welcome({ owner, storeName, onStart, onLater }) {
  return (
    <div className="ob-welcome">
      <div className="ob-welcome-inner">
        <span className="ob-eyebrow"><span className="ob-dot" /> Setup · about 5 minutes</span>
        <h1>Welcome{owner ? `, ${owner}` : ""}.<br />Let&apos;s turn visitors into <em>repeat customers.</em></h1>
        <p className="ob-welcome-lede">A few quick steps and <b>{storeName}</b> will be recovering carts, capturing emails, and running automations on autopilot.</p>
        <div className="ob-preview-tasks">
          {TASKS.map((t, i) => (
            <div className="ob-preview-task" key={t.id}>
              <span className="ob-ptn">{i + 1}</span>
              <span>{t.title}</span>
              <span className="ob-pt-time">{t.time}</span>
            </div>
          ))}
        </div>
        <div className="ob-welcome-cta">
          <button className="ob-btn ob-btn-primary ob-btn-lg" onClick={onStart}>Get started <Icons.Arrow size={16} /></button>
          <button className="ob-later" onClick={onLater}>I&apos;ll set up later</button>
        </div>
      </div>
    </div>
  );
}

// ── Live celebration ───────────────────────────────────────────────────
function Confetti() {
  const colors = ["#E8F25A", "#1F3D2F", "#356A53", "#C0B697", "#DCE7DF"];
  const pieces = Array.from({ length: 70 }).map((_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    dur: 2.6 + Math.random() * 1.8,
    color: colors[i % colors.length],
    rot: Math.random() * 360,
    w: 6 + Math.random() * 6,
  }));
  return (
    <div className="ob-confetti">
      {pieces.map((p, i) => (
        <span key={i} className="ob-conf" style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, width: p.w, height: p.w * 1.5, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}

function Live({ onDashboard, onSetup, hasOptionalLeft }) {
  return (
    <div className="ob-live">
      <Confetti />
      <div className="ob-live-inner">
        <div className="ob-live-badge"><Icons.Sparkles size={44} /></div>
        <h1>Retainify is live.</h1>
        <p className="ob-live-lede">Your store is now set up and ready. Head to your dashboard to see performance as it comes in.</p>
        <div className="ob-live-cta">
          <button className="ob-btn ob-btn-primary ob-btn-lg" onClick={onDashboard}>Go to dashboard <Icons.Arrow size={16} /></button>
          {hasOptionalLeft && (
            <button className="ob-btn ob-btn-secondary ob-btn-lg" onClick={onSetup}>Finish setup guide</button>
          )}
        </div>
      </div>
    </div>
  );
}

function TopBar({ storeName }) {
  const initial = (storeName || "R").trim().charAt(0).toUpperCase();
  return (
    <div className="ob-top">
      <div className="ob-brand"><span className="ob-mark">R</span><span className="ob-brand-name">Retainify</span></div>
      <div className="ob-top-right">
        <div className="ob-store-chip"><span className="ob-store-dot">{initial}</span> {storeName}</div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const data = useLoaderData();
  const { shop, apiKey, callUrl, owner, storeName, done, skipped } = data;
  const navigate = useNavigate();
  const location = useLocation();
  const activateFetcher = useFetcher();

  // Phase: welcome → checklist → live. If the merchant is already activated
  // (shouldn't normally land here), jump straight to the live celebration.
  const [phase, setPhase] = useState(data.activated ? "live" : "welcome");

  useEffect(() => { window.scrollTo(0, 0); }, [phase]);

  // When activation succeeds, advance to the live celebration.
  useEffect(() => {
    if (activateFetcher.state === "idle" && activateFetcher.data?.activated) {
      setPhase("live");
    }
  }, [activateFetcher.state, activateFetcher.data]);

  const ctx = {
    shop,
    storeName,
    senderName: data.settings.senderName === "Your Store" ? "" : data.settings.senderName,
    sendingFromAddress: data.sendingFromAddress,
    replyTo: data.settings.replyTo || "",
    themeEditorUrl: themeEditorEmbedUrl(shop, apiKey),
    callUrl,
    search: location.search,
  };

  const hasOptionalLeft = TASKS.some((t) => t.optional && !done[t.id] && !skipped[t.id]);

  return (
    <div className="ob-root">
      <div className="ob-noise" />
      <TopBar storeName={storeName} />

      {phase === "welcome" && (
        <Welcome
          owner={owner}
          storeName={storeName}
          onStart={() => setPhase("checklist")}
          onLater={() => setPhase("checklist")}
        />
      )}

      {phase === "checklist" && (
        <OnboardingChecklist
          state={{ done, skipped }}
          ctx={ctx}
          variant="onboarding"
          owner={owner}
          onActivate={() => activateFetcher.submit({ intent: "activate" }, { method: "post" })}
        />
      )}

      {phase === "live" && (
        <Live
          hasOptionalLeft={hasOptionalLeft}
          onDashboard={() => navigate(`/app${location.search}`)}
          onSetup={() => navigate(`/app/setup${location.search}`)}
        />
      )}
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
