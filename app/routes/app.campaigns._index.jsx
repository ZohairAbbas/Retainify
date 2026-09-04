/**
 * Campaigns — one-off broadcast sends.
 *
 * Separate from Flows because the jobs are different: a flow runs whenever
 * something happens, a campaign goes out once to an audience you pick. They
 * share the Journey model underneath (see lib/journey/broadcast.server.js), but
 * presenting them together would force one screen to explain two ideas.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useLocation, useRouteError, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import Icons from "../components/ui/Icons.jsx";
import { ConfirmDialog, PromptDialog, Toast } from "../components/ui/Dialog.jsx";
import { relativeTime } from "../components/contacts/constants.js";

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;

  const campaigns = await prisma.journey.findMany({
    where: { shop, trigger: "broadcast", archivedAt: null },
    include: { steps: { where: { isArchived: false }, take: 1 } },
    orderBy: [{ createdAt: "desc" }],
  });

  const ids = campaigns.map((c) => c.id);
  // Two queries rather than a union, because the two channels do not report the
  // same events: email has opens, WhatsApp has reads and no open at all. Each
  // is mapped onto the table's three columns by the row that renders it.
  const [emailStats, waStats] = ids.length
    ? await Promise.all([
        prisma.$queryRaw`
        SELECT s."journeyId" AS "journeyId",
               COUNT(*) FILTER (WHERE j."sentAt"    IS NOT NULL) AS sent,
               COUNT(*) FILTER (WHERE j."openedAt"  IS NOT NULL) AS opened,
               COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL) AS clicked
          FROM "JourneyJob" j
          JOIN "JourneyStep" s ON s.id = j."stepId"
         WHERE s."journeyId" = ANY(${ids})
         GROUP BY s."journeyId"`,
        prisma.$queryRaw`
        SELECT s."journeyId" AS "journeyId",
               COUNT(*) FILTER (WHERE w."sentAt"    IS NOT NULL) AS sent,
               COUNT(*) FILTER (WHERE w."readAt"    IS NOT NULL) AS opened,
               COUNT(*) FILTER (WHERE w."clickedAt" IS NOT NULL) AS clicked
          FROM "WhatsappJob" w
          JOIN "JourneyStep" s ON s.id = w."stepId"
         WHERE s."journeyId" = ANY(${ids})
         GROUP BY s."journeyId"`,
      ])
    : [[], []];
  const byId = Object.fromEntries(
    [...emailStats, ...waStats].map((r) => [r.journeyId, {
      sent: Number(r.sent) || 0,
      opened: Number(r.opened) || 0,
      clicked: Number(r.clicked) || 0,
    }]),
  );

  return {
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      channel: c.steps[0]?.nodeType === "whatsapp" ? "whatsapp" : "email",
      subject: c.steps[0]?.subject || "",
      waTemplateName: c.steps[0]?.waTemplateName || "",
      status: campaignStatus(c),
      scheduledFor: c.scheduledFor,
      dispatchedAt: c.dispatchedAt,
      recipientCount: c.recipientCount,
      updatedAt: c.updatedAt,
      stats: byId[c.id] || { sent: 0, opened: 0, clicked: 0 },
    })),
  };
};

/**
 * A campaign's state is derived rather than stored, so it can't drift from the
 * facts: published + dispatched = sent, published + future = scheduled.
 */
function campaignStatus(c) {
  if (c.status === "draft") return "draft";
  if (c.dispatchedAt) return "sent";
  if (c.status === "paused") return "paused";
  return "scheduled";
}

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "create") {
    const name = String(fd.get("name") || "").trim() || "Untitled campaign";
    // The channel is the step's node type. Anything but "whatsapp" is email,
    // so a missing or unrecognised value keeps the previous behaviour.
    const channel = String(fd.get("channel") || "email") === "whatsapp" ? "whatsapp" : "email";
    const campaign = await prisma.journey.create({
      data: {
        shop,
        name,
        trigger: "broadcast",
        status: "draft",
        isActive: false,
        source: "campaigns",
        // A broadcast must never enrol the same person twice, whatever else
        // happens. This is the second of three guards (see broadcast.server.js).
        entryFrequency: "no_reentry",
        steps: {
          create: {
            stepNumber: 1,
            positionY: 0,
            nodeType: channel,
            delayHours: 0,
            ...(channel === "whatsapp"
              ? { waTemplateName: "", waLanguage: "" }
              : { emailName: name, subject: "" }),
          },
        },
      },
    });
    const url = new URL(request.url);
    return redirect(`/app/campaigns/${campaign.id}${url.search}`);
  }

  if (intent === "archive") {
    const id = String(fd.get("id") || "");
    await prisma.journey.updateMany({
      where: { id, shop, trigger: "broadcast" },
      data: { archivedAt: new Date(), status: "paused", isActive: false },
    });
    return { ok: true, archived: true };
  }

  if (intent === "cancel") {
    // Only meaningful before dispatch. Once enrolled, the jobs are already
    // queued and stopping them is a different operation.
    const id = String(fd.get("id") || "");
    const result = await prisma.journey.updateMany({
      where: { id, shop, trigger: "broadcast", dispatchedAt: null },
      data: { status: "draft", isActive: false, scheduledFor: null },
    });
    return result.count
      ? { ok: true, cancelled: true }
      : { ok: false, error: "That campaign has already started sending." };
  }

  return { ok: false };
};

/**
 * Channel is chosen once, at creation, because it decides what the editor even
 * is — a subject line and HTML, or an approved template and its variables.
 * A draft can still be switched on the campaign page; a sent one cannot.
 */
const CHANNEL_CHOICE = {
  label: "Channel",
  initial: "email",
  options: [
    { value: "email", label: "Email", hint: "Subject line, content blocks or your own HTML." },
    {
      value: "whatsapp",
      label: "WhatsApp",
      hint: "An approved template. Reaches contacts who opted in to WhatsApp — a different audience from your email list.",
    },
  ],
};

const STATUS_LABEL = {
  draft: { label: "Draft", cls: "draft" },
  scheduled: { label: "Scheduled", cls: "active" },
  sent: { label: "Sent", cls: "active" },
  paused: { label: "Paused", cls: "paused" },
};

export default function Campaigns() {
  const { campaigns } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher();
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const busy = fetcher.state !== "idle";

  const open = (id) => navigate(`/app/campaigns/${id}${location.search}`);
  const fmt = (n) => new Intl.NumberFormat("en-US").format(n || 0);
  const rate = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

  if (campaigns.length === 0) {
    return (
      <div className="rt-page">
        <div className="rt-empty">
          <div className="rt-empty-art"><Icons.Send size={40} /></div>
          <h2 className="t-display-2" style={{ margin: 0, color: "var(--ink-1)" }}>
            Send something <em style={{ fontFamily: "var(--font-display)", color: "var(--brand-700)" }}>once</em>.
          </h2>
          <p className="rt-empty-lede">
            A campaign goes out one time to an audience you choose — a newsletter, an
            announcement, an offer. Flows handle the automatic ones.
          </p>
          <div className="rt-empty-actions">
            <button className="btn btn-primary btn-lg" onClick={() => setDialog({ kind: "create" })}>
              <Icons.Plus size={14} /> New campaign
            </button>
          </div>
        </div>
        {dialog?.kind === "create" && (
          <PromptDialog
            title="New campaign"
            label="Campaign name"
            placeholder="e.g. March newsletter"
            body="Just for your reference — recipients never see it."
            confirmLabel="Create"
            loading={busy}
            choices={CHANNEL_CHOICE}
            onCancel={() => setDialog(null)}
            onConfirm={(name, channel) => { fetcher.submit({ intent: "create", name, channel }, { method: "post" }); setDialog(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · Messaging</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Campaigns</h1>
          <p className="t-body muted" style={{ margin: "8px 0 0", maxWidth: 540 }}>
            One-off sends to an audience you pick. For anything that should send
            automatically, use a flow instead.
          </p>
        </div>
        <div className="rt-page-actions">
          <button className="btn btn-primary" onClick={() => setDialog({ kind: "create" })}>
            <Icons.Plus size={14} /> New campaign
          </button>
        </div>
      </header>

      <div className="tscroll" style={{ overflowX: "auto" }}>
        <div className="rt-table" style={{ minWidth: 760 }}>
          <div className="rt-thead">
            <div>Campaign</div>
            <div>Status</div>
            <div>When</div>
            <div className="rt-tnum">Sent</div>
            <div className="rt-tnum">Opened</div>
            <div className="rt-tnum">Clicked</div>
            <div />
          </div>
          {campaigns.map((c) => {
            const s = STATUS_LABEL[c.status] || STATUS_LABEL.draft;
            return (
              <div
                key={c.id}
                className="rt-trow"
                onClick={(e) => { if (!e.target.closest(".rt-tactions")) open(c.id); }}
                style={{ cursor: "pointer" }}
              >
                <div className="rt-tcell-name">
                  <div className={`rt-trig-dot rt-tint-${c.channel}`}>
                    {c.channel === "whatsapp" ? <Icons.Whatsapp size={14} /> : <Icons.Send size={14} />}
                  </div>
                  <div>
                    <div className="rt-flow-name">{c.name}</div>
                    <div className="rt-flow-meta">
                      {c.channel === "whatsapp"
                        ? c.waTemplateName || <em className="faint">No template yet</em>
                        : c.subject || <em className="faint">No subject yet</em>}
                    </div>
                  </div>
                </div>
                <div><span className={`pill ${s.cls}`}>{s.label}</span></div>
                <div className="rt-tdate">
                  {c.dispatchedAt
                    ? `Sent ${relativeTime(c.dispatchedAt)}`
                    : c.scheduledFor
                      ? new Date(c.scheduledFor).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                </div>
                <div className="rt-tnum t-mono">{fmt(c.stats.sent)}</div>
                {/* Read rate for WhatsApp, open rate for email. Meta reports a
                    read receipt and no open; the two are close enough in
                    meaning to share a column and are labelled per row. */}
                <div className="rt-tnum t-mono" title={c.channel === "whatsapp" ? "Read rate" : "Open rate"}>
                  {rate(c.stats.opened, c.stats.sent)}
                </div>
                <div className="rt-tnum t-mono">{rate(c.stats.clicked, c.stats.sent)}</div>
                <div className="rt-tactions" onClick={(e) => e.stopPropagation()}>
                  <RowMenu
                    campaign={c}
                    onOpen={() => open(c.id)}
                    onAnalytics={() => navigate(`/app/flows/${c.id}/analytics${location.search}`)}
                    onCancel={() => setDialog({ kind: "cancel", c })}
                    onArchive={() => setDialog({ kind: "archive", c })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {dialog?.kind === "create" && (
        <PromptDialog
          title="New campaign"
          label="Campaign name"
          placeholder="e.g. March newsletter"
          body="Just for your reference — recipients never see it."
          confirmLabel="Create"
          loading={busy}
          choices={CHANNEL_CHOICE}
          onCancel={() => setDialog(null)}
          onConfirm={(name, channel) => { fetcher.submit({ intent: "create", name, channel }, { method: "post" }); setDialog(null); }}
        />
      )}
      {dialog?.kind === "cancel" && (
        <ConfirmDialog
          title={`Cancel "${dialog.c.name}"?`}
          body="It returns to draft and won't send. This only works before sending starts."
          confirmLabel="Cancel send"
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => { fetcher.submit({ intent: "cancel", id: dialog.c.id }, { method: "post" }); setDialog(null); }}
        />
      )}
      {dialog?.kind === "archive" && (
        <ConfirmDialog
          title={`Archive "${dialog.c.name}"?`}
          body="It's hidden from this list. Its send history stays available in the report."
          confirmLabel="Archive"
          destructive
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => { fetcher.submit({ intent: "archive", id: dialog.c.id }, { method: "post" }); setDialog(null); }}
        />
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

/**
 * Row actions.
 *
 * The menu is positioned `fixed` from the trigger's rect rather than `absolute`
 * inside the row. Two ancestors clip it otherwise: `.rt-table` is
 * `overflow: hidden` (for its rounded corners) and the wrapper here is
 * `overflow-x: auto` (so a 760px table scrolls on narrow screens) — and an
 * `auto` on one axis stops the other axis being `visible`. An absolute menu is
 * cropped to the row, which on a short list hides every option.
 */
function RowMenu({ campaign, onOpen, onAnalytics, onCancel, onArchive }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  // Measured before paint so the menu never shows at the wrong spot for a frame.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }, [open]);

  // A fixed menu doesn't travel with its row, so anything that moves the row
  // closes it rather than leaving it stranded mid-page.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icons.More size={16} />
      </button>
      {open && pos && (
        <>
          <div className="rt-veil" onClick={() => setOpen(false)} />
          {/* Inline position overrides the absolute placement in the
              `.rt-tactions .rt-menu` rule; the class still supplies the look. */}
          <div
            className="rt-menu"
            role="menu"
            style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 12 }}
          >
            <button onClick={() => { setOpen(false); onOpen(); }}>
              <Icons.Eye size={14} /> {campaign.dispatchedAt ? "View" : "Edit"}
            </button>
            {campaign.stats.sent > 0 && (
              <button onClick={() => { setOpen(false); onAnalytics(); }}>
                <Icons.Chart size={14} /> Report
              </button>
            )}
            {campaign.status === "scheduled" && (
              <button onClick={() => { setOpen(false); onCancel(); }}>
                <Icons.Close size={14} /> Cancel send
              </button>
            )}
            <div className="rt-menu-sep" />
            <button className="rt-menu-danger" onClick={() => { setOpen(false); onArchive(); }}>
              <Icons.Trash size={14} /> Archive
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
