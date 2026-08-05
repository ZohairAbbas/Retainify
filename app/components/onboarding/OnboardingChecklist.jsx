import { useState } from "react";
import { useFetcher, useNavigate, useLocation } from "react-router";
import Icons from "../ui/Icons.jsx";
import { TASKS, ESSENTIAL_IDS } from "../../lib/onboarding/tasks.js";

// ── Small helpers ──────────────────────────────────────────────────────
function InfoDot() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" />
    </svg>
  );
}

// ── Task panels ────────────────────────────────────────────────────────
// Each panel receives: ctx (shop, senderName, senderEmail, replyTo, themeEditorUrl,
// callUrl, search), onComplete(), onSkip(). Panels never fake progress — they
// submit to the route action or deep-link to the real editor pages.

function StorePanel({ ctx, onAdvance }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const initial = (ctx.storeName || ctx.shop || "N").trim().charAt(0).toUpperCase();
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">We detected the store this app was installed on. Confirm it&apos;s the right one — everything Retainify sends and shows will run here.</p>
      <div className="ob-store-confirm">
        <div className="ob-store-avatar">{initial}</div>
        <div className="ob-store-info">
          <div className="ob-si-name">{ctx.storeName || ctx.shop}</div>
          <div className="ob-si-domain">{ctx.shop}</div>
        </div>
        <span className="ob-store-badge"><Icons.Check size={13} /> Connected</span>
      </div>
      <div className="ob-panel-actions">
        <button
          className="ob-btn ob-btn-primary"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "complete-task", taskId: "store" }, { method: "post" })}
        >
          {busy ? <><span className="ob-spin" />Confirming…</> : "Confirm & continue"}
        </button>
        <span className="ob-time-tag"><Icons.Clock size={13} /> Auto-detected</span>
      </div>
      <CompleteWatcher fetcher={fetcher} onComplete={onAdvance} />
    </div>
  );
}

function SenderPanel({ ctx, onAdvance }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const [name, setName] = useState(ctx.senderName || ctx.storeName || "");
  const [reply, setReply] = useState(ctx.replyTo || "");
  const valid = !!name.trim();
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">This is the “From” name shoppers see in their inbox. A recognizable sender lifts open rates — use your store name. Emails go out from our shared, deliverability-optimized address.</p>
      <div className="ob-field-row">
        <div>
          <label className="ob-field-label">Sender name</label>
          <input className="ob-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your store name" />
        </div>
        <div>
          <label className="ob-field-label">Sender email</label>
          <input className="ob-input" type="email" value={ctx.sendingFromAddress || ""} disabled readOnly />
        </div>
      </div>
      <div className="ob-field-full">
        <label className="ob-field-label">Reply-to email <span className="ob-faint">(optional)</span></label>
        <input className="ob-input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Where replies should land" />
      </div>
      <div className="ob-hint"><InfoDot /><span>Emails are sent from this shared, deliverability-optimized address. Contact support to use your own domain for email sending.</span></div>
      <div className="ob-panel-actions">
        <button
          className={`ob-btn ob-btn-primary ${valid ? "" : "is-disabled"}`}
          disabled={busy || !valid}
          onClick={() => fetcher.submit(
            { intent: "save-sender", senderName: name, replyTo: reply },
            { method: "post" },
          )}
        >
          {busy ? <><span className="ob-spin" />Saving…</> : "Save sender details"}
        </button>
      </div>
      <CompleteWatcher fetcher={fetcher} onComplete={onAdvance} />
    </div>
  );
}

function EmbedPanel({ ctx, onAdvance }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const [opened, setOpened] = useState(false);
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Your popups and on-site nudges run through a Retainify app embed in your theme. Turn it on once — click below to open your theme editor with the embed pre-highlighted, then hit <b>Save</b> in the top-right.</p>
      <div className="ob-hint"><InfoDot /><span>Nothing appears on your storefront until you also publish a popup. The embed just gives Retainify permission to render.</span></div>
      <div className="ob-panel-actions">
        {!opened ? (
          <a
            className="ob-btn ob-btn-primary"
            href={ctx.themeEditorUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpened(true)}
          >
            <Icons.Exit size={15} /> Open theme editor to enable
          </a>
        ) : (
          <button
            className="ob-btn ob-btn-primary"
            disabled={busy}
            onClick={() => fetcher.submit({ intent: "complete-task", taskId: "embed" }, { method: "post" })}
          >
            {busy ? <><span className="ob-spin" />Confirming…</> : <><Icons.Check size={14} /> I&apos;ve enabled it — continue</>}
          </button>
        )}
      </div>
      <CompleteWatcher fetcher={fetcher} onComplete={onAdvance} />
    </div>
  );
}

function PopupPanel({ ctx, onComplete }) {
  const navigate = useNavigate();
  const storeUrl = ctx.shop.replace(".myshopify.com", "");
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Start capturing emails from day one. This “Join the club” form appears to first-time visitors — publish it now and refine the copy, image, and timing later from the Popups page.</p>
      <div className="ob-popup-preview">
        <div className="ob-store-mini">
          <div className="ob-store-mini-bar"><i /><i /><i /><span className="ob-store-mini-url">{storeUrl}</span></div>
          <div className="ob-store-mini-body">
            <div className="ob-smb-line" style={{ width: "40%" }} />
            <div className="ob-smb-line" style={{ width: "85%", height: 38 }} />
            <div className="ob-smb-line" style={{ width: "70%" }} />
            <div className="ob-smb-line" style={{ width: "55%" }} />
          </div>
          <div className="ob-store-dim2">
            <div className="ob-mini-popup">
              <div className="ob-mini-popup-img" />
              <div className="ob-mini-popup-c">
                <div className="ob-mini-popup-h">Join the club — 10% off</div>
                <div className="ob-mini-popup-p">Get first access to drops and members-only deals, straight to your inbox.</div>
                <div className="ob-mini-popup-input" />
                <div className="ob-mini-popup-btn">Count me in</div>
              </div>
            </div>
          </div>
        </div>
        <div className="ob-popup-side">
          <h4>Welcome popup</h4>
          <p>Email capture · shows after 5s to new visitors · mobile-optimized. Editorial template, matched to your brand.</p>
          <div className="ob-panel-actions" style={{ marginTop: 0 }}>
            <button className="ob-btn ob-btn-primary" onClick={() => navigate(`/app/popup${ctx.search}`)}>
              <Icons.Megaphone size={15} /> Set up popup
            </button>
            <button className="ob-skip-btn" onClick={onComplete}>Mark as done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const FLOW_OPTS = [
  { id: "cart", icon: "Cart", title: "Cart recovery", desc: "Win back shoppers who leave items behind — a 3-email sequence with a nudge and an offer.", stat: "Recovers ~12% of abandoned carts" },
  { id: "welcome", icon: "Heart", title: "Welcome series", desc: "Greet new subscribers, tell your story, and turn the first-purchase intent into a sale.", stat: "↑ First-order conversion" },
];

function FlowPanel({ ctx, onComplete }) {
  const navigate = useNavigate();
  const [sel, setSel] = useState("cart");
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Turn on your first automation. Pick a starting point — it launches pre-built with proven copy and timing, and you can tweak every step in the flow builder afterward.</p>
      <div className="ob-flow-grid">
        {FLOW_OPTS.map((o) => {
          const Ic = Icons[o.icon];
          return (
            <button key={o.id} className={`ob-flow-opt ${sel === o.id ? "sel" : ""}`} onClick={() => setSel(o.id)}>
              <span className="ob-radio" />
              <div className="ob-flow-opt-ic"><Ic size={18} /></div>
              <div className="ob-flow-opt-title">{o.title}</div>
              <div className="ob-flow-opt-desc">{o.desc}</div>
              <div className="ob-flow-opt-stat"><Icons.Bolt size={12} /> {o.stat}</div>
            </button>
          );
        })}
      </div>
      <div className="ob-panel-actions">
        <button className="ob-btn ob-btn-primary" onClick={() => navigate(`/app/flows${ctx.search}`)}>
          <Icons.Play size={14} /> Go to Flows
        </button>
        <button className="ob-skip-btn" onClick={onComplete}>Mark as done</button>
      </div>
    </div>
  );
}

function CallPanel({ ctx, onComplete, onSkip }) {
  const hasUrl = ctx.callUrl && ctx.callUrl !== "#";
  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">Optional, but worth it. A 20-minute call with an onboarding specialist to review your flows, deliverability, and a 30-day plan tailored to {ctx.storeName || "your store"}.</p>
      <div className="ob-call-card">
        <div className="ob-call-ic"><Icons.Clock size={22} /></div>
        <div className="ob-call-info">
          <h4>Book a free onboarding call</h4>
          <p>1-on-1 walkthrough · 20 min · no cost</p>
        </div>
      </div>
      <div className="ob-panel-actions">
        {hasUrl ? (
          <a className="ob-btn ob-btn-primary" href={ctx.callUrl} target="_blank" rel="noreferrer" onClick={onComplete}>
            Pick a time <Icons.Exit size={14} />
          </a>
        ) : (
          <button className="ob-btn ob-btn-primary is-disabled" disabled title="Scheduling link coming soon">
            Pick a time
          </button>
        )}
        <button className="ob-skip-btn" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  );
}

function DomainPanel({ ctx, onComplete, onSkip }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const [domain, setDomain] = useState("");
  const err = fetcher.data?.domainError;
  const records = ctx.domainRecords || [];

  // Verified — nothing more to do here.
  if (ctx.domainVerified) {
    return (
      <div className="ob-panel-pad">
        <p className="ob-panel-lede">✅ <b>{ctx.verifiedDomain}</b> is verified. Your emails now send from your own domain.</p>
        <CompleteWatcher fetcher={fetcher} onComplete={onComplete} />
      </div>
    );
  }

  return (
    <div className="ob-panel-pad">
      <p className="ob-panel-lede">
        Optional. Send emails from your own domain instead of our shared address —
        better brand recognition and deliverability. This needs DNS changes, so you
        can skip and set it up later from Settings.
      </p>

      {err && <div className="ob-hint" style={{ color: "var(--danger, #c0392b)" }}><span>{err}</span></div>}

      {ctx.verifiedDomain ? (
        <>
          <div className="ob-hint"><InfoDot /><span>Add these DNS records for <b>{ctx.verifiedDomain}</b> at your domain provider, then click Verify. Status: <b>{ctx.domainStatus || "pending"}</b>.</span></div>
          <div style={{ overflowX: "auto", margin: "10px 0" }}>
            <table className="ob-dns-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ textAlign: "left" }}><th>Type</th><th>Name</th><th>Value</th><th>Priority</th></tr></thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i}>
                    <td>{r.type}</td>
                    <td style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{r.name}</td>
                    <td style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{r.value}</td>
                    <td>{r.priority ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ob-panel-actions">
            <button className="ob-btn ob-btn-primary" disabled={busy}
              onClick={() => fetcher.submit({ intent: "verify-domain" }, { method: "post" })}>
              {busy ? <><span className="ob-spin" />Checking…</> : "Verify domain"}
            </button>
            <button className="ob-skip-btn" onClick={onSkip}>Skip for now</button>
          </div>
        </>
      ) : ctx.slotAvailable ? (
        <>
          <div className="ob-field-full">
            <label className="ob-field-label">Your domain</label>
            <input className="ob-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourbrand.com" />
          </div>
          <div className="ob-panel-actions">
            <button className={`ob-btn ob-btn-primary ${domain.trim() ? "" : "is-disabled"}`} disabled={busy || !domain.trim()}
              onClick={() => fetcher.submit({ intent: "add-domain", domain: domain.trim() }, { method: "post" })}>
              {busy ? <><span className="ob-spin" />Adding…</> : "Add domain"}
            </button>
            <button className="ob-skip-btn" onClick={onSkip}>Skip for now</button>
          </div>
        </>
      ) : (
        <>
          <div className="ob-hint"><InfoDot /><span>Custom sending domains are currently full. You can use the shared address for now — contact us to request your own.</span></div>
          <div className="ob-panel-actions">
            <button className="ob-skip-btn" onClick={onSkip}>Continue</button>
          </div>
        </>
      )}
      {/* Re-render happens via loader revalidation after add/verify; onComplete
          fires only when the step becomes verified (handled by the verified branch). */}
    </div>
  );
}

const PANELS = {
  store: StorePanel,
  sender: SenderPanel,
  domain: DomainPanel,
  embed: EmbedPanel,
  popup: PopupPanel,
  flow: FlowPanel,
  call: CallPanel,
};

// Fires onComplete once when a submitting fetcher lands an ok result.
function CompleteWatcher({ fetcher, onComplete }) {
  const done = fetcher.state === "idle" && fetcher.data?.ok;
  const [fired, setFired] = useState(false);
  if (done && !fired) {
    setFired(true);
    // defer so we don't setState of parent during render of child
    queueMicrotask(() => onComplete && onComplete());
  }
  if (!done && fired) setFired(false);
  return null;
}

// ── Progress ring ──────────────────────────────────────────────────────
function Ring({ done, total }) {
  const r = 26, c = 2 * Math.PI * r, pct = total ? done / total : 0;
  return (
    <div className="ob-progress-ring">
      <svg width="60" height="60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(244,239,228,0.2)" strokeWidth="5" />
        <circle cx="30" cy="30" r={r} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 640ms var(--ease)" }} />
      </svg>
      <span className="ob-progress-ring-num">{done}/{total}</span>
    </div>
  );
}

/**
 * Shared checklist surface. Rendered both in the pre-activation onboarding
 * takeover and the post-activation Setup Guide page.
 *
 * Props:
 *  - state: { done, skipped } maps keyed by task id (from loader)
 *  - ctx:   per-task context (shop, sender values, themeEditorUrl, callUrl, search…)
 *  - variant: "onboarding" | "setup" — tweaks copy + which tasks show
 *  - owner:  merchant first name (optional)
 *  - onActivate: called when the merchant clicks the activate CTA (onboarding only)
 */
export default function OnboardingChecklist({ state, ctx, variant = "onboarding", owner, onActivate }) {
  const location = useLocation();
  const fetcher = useFetcher();

  // In setup variant we only surface the still-unresolved tasks (the guide is a
  // nudge for what's left), while onboarding shows the full list.
  const tasks = variant === "setup"
    ? TASKS.filter((t) => !(state.done[t.id] || state.skipped[t.id]))
    : TASKS;

  const [open, setOpen] = useState(() => {
    const first = tasks.find((t) => !state.done[t.id] && !state.skipped[t.id]);
    return first ? first.id : null;
  });

  const reqDone = ESSENTIAL_IDS.filter((id) => state.done[id]).length;
  const reqTotal = ESSENTIAL_IDS.length;
  const pct = Math.round((reqDone / reqTotal) * 100);
  const allRequiredDone = reqDone === reqTotal;

  function advanceFrom(id) {
    const next = tasks.find((t) => t.id !== id && !state.done[t.id] && !state.skipped[t.id]);
    setOpen(next ? next.id : null);
  }

  function markSkip(id) {
    fetcher.submit({ intent: "skip-task", taskId: id }, { method: "post" });
    advanceFrom(id);
  }
  function markComplete(id) {
    // popup/flow "mark as done" write a manual completion too (in case the
    // merchant marks it before actually configuring). Server ignores the write
    // for auto tasks but skips let it resolve; here we post complete to record intent.
    fetcher.submit({ intent: "complete-task", taskId: id }, { method: "post" });
    advanceFrom(id);
  }

  return (
    <div className={variant === "setup" ? "ob-guide" : "ob-page"}>
      {variant === "onboarding" && (
        <div className="ob-header">
          <h1>Hey {owner || "there"} <span className="ob-wave">👋</span></h1>
          <p>Finish setting up {ctx.storeName || "your store"} — do these in any order, your progress is saved.</p>
        </div>
      )}

      {variant === "onboarding" && (
        <div className="ob-progress-card">
          <div className="ob-progress-copy">
            <div className="ob-pc-title">{allRequiredDone ? "You're ready to go live" : "Never lose another visitor"}</div>
            <div className="ob-pc-sub">{allRequiredDone ? "All essentials done — activate whenever you're ready." : `${reqTotal - reqDone} essential ${reqTotal - reqDone === 1 ? "step" : "steps"} left to launch`}</div>
          </div>
          <div className="ob-progress-bar-wrap">
            <div className="ob-progress-bar-top">
              <span className="ob-pb-count">{reqDone} of {reqTotal} essentials</span>
              <span className="ob-pb-pct">{pct}%</span>
            </div>
            <div className="ob-progress-track"><div className="ob-progress-fill" style={{ width: `${pct}%` }} /></div>
          </div>
          <Ring done={reqDone} total={reqTotal} />
        </div>
      )}

      <div className="ob-tasks">
        {tasks.map((t, i) => {
          const isDone = !!state.done[t.id];
          const isSkipped = !!state.skipped[t.id];
          const isOpen = open === t.id;
          const Panel = PANELS[t.panel];
          return (
            <div key={t.id} className={`ob-task ${isOpen ? "is-open" : ""} ${isDone ? "is-done" : ""}`} style={{ animationDelay: `${i * 55}ms` }}>
              <button className="ob-task-head" onClick={() => setOpen(isOpen ? null : t.id)}>
                <span className="ob-task-num">{isDone ? <Icons.Check size={16} className="ob-check-anim" /> : (i + 1)}</span>
                <div className="ob-task-body-head">
                  <div className="ob-task-title">{t.title}</div>
                  <div className="ob-task-sub">{isSkipped && !isDone ? "Skipped — you can do this anytime" : t.sub}</div>
                </div>
                <div className="ob-task-meta">
                  {isDone ? <span className="ob-done-word"><Icons.Check size={13} /> Done</span> : (
                    <>
                      {t.optional && <span className="ob-optional-tag">Optional</span>}
                      <span className="ob-time-tag"><Icons.Clock size={13} /> {t.time}</span>
                      <span className="ob-chev"><Icons.Chevron size={16} /></span>
                    </>
                  )}
                </div>
              </button>
              <div className="ob-task-panel"><div className="ob-task-panel-inner">
                {Panel && (
                  <Panel
                    ctx={ctx}
                    onAdvance={() => advanceFrom(t.id)}
                    onComplete={() => markComplete(t.id)}
                    onSkip={() => markSkip(t.id)}
                  />
                )}
              </div></div>
            </div>
          );
        })}
      </div>

      {variant === "onboarding" && (
        <div className="ob-panel-actions" style={{ justifyContent: "center", marginTop: 30 }}>
          <button
            className="ob-btn ob-btn-primary ob-btn-lg"
            disabled={!allRequiredDone}
            onClick={onActivate}
            style={!allRequiredDone ? { opacity: 0.45, cursor: "not-allowed" } : {}}
          >
            {allRequiredDone ? <>Activate Retainify <Icons.Sparkles size={16} /></> : `Complete ${reqTotal - reqDone} more to activate`}
          </button>
        </div>
      )}

      <div className="ob-foot">Stuck on a step? <a href={`/app/settings${location.search}`}>Open settings</a> or reach out to support.</div>
    </div>
  );
}
