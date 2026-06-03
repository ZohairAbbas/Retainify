import { useState } from "react";
import { redirect, useFetcher, useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import Icons from "../components/ui/Icons.jsx";
import Avatar from "../components/contacts/Avatar.jsx";
import StatusPill from "../components/contacts/StatusPill.jsx";
import LifecyclePill from "../components/contacts/LifecyclePill.jsx";
import LifecycleJourney from "../components/contacts/LifecycleJourney.jsx";
import SuppressionBanner from "../components/contacts/SuppressionBanner.jsx";
import MiniStat from "../components/contacts/MiniStat.jsx";
import TimelineEvent from "../components/contacts/TimelineEvent.jsx";
import EmptyTab from "../components/contacts/EmptyTab.jsx";
import CartsTable from "../components/contacts/CartsTable.jsx";
import EmailsTable from "../components/contacts/EmailsTable.jsx";
import PushesTable from "../components/contacts/PushesTable.jsx";
import TagsCard from "../components/contacts/TagsCard.jsx";
import SubscriptionCard from "../components/contacts/SubscriptionCard.jsx";
import SegmentsCard from "../components/contacts/SegmentsCard.jsx";
import JourneysCard from "../components/contacts/JourneysCard.jsx";
import CustomPropsCard from "../components/contacts/CustomPropsCard.jsx";
import { fmtMoney, fmtPctC, relativeTime } from "../components/contacts/constants.js";
import prisma from "../db.server.js";
import {
  computeLifecycle,
  getContactById,
  getContactStats,
  resubscribeContact,
  softDeleteContact,
  unsubscribeContact,
  updateContactName,
} from "../lib/contacts/contacts.server.js";
import {
  buildTimeline,
  getContactCarts,
  getContactEmails,
  getContactJourneys,
  getContactPushes,
} from "../lib/contacts/timeline.server.js";
import {
  applyTag,
  applyTagByName,
  listTagsForShop,
  removeTag,
} from "../lib/contacts/tags.server.js";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const contact = await getContactById(shop, params.id);
  if (!contact) {
    throw new Response("Not found", { status: 404 });
  }

  const [stats, timeline, carts, emails, pushes, journeys, allTags, pushSubs, lastSuppression] =
    await Promise.all([
      getContactStats(shop, contact.email),
      buildTimeline(shop, contact.email),
      getContactCarts(shop, contact.email),
      getContactEmails(shop, contact.email),
      getContactPushes(shop, contact.email),
      getContactJourneys(shop, contact.email),
      listTagsForShop(shop),
      prisma.pushSubscription.count({
        where: { shop, contactEmail: contact.email, isActive: true },
      }),
      prisma.emailSuppression.findFirst({
        where: { shop, email: contact.email },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  return {
    contact: {
      id: contact.id,
      email: contact.email,
      name: contact.name,
      firstSeenAt: contact.firstSeenAt,
      lastSeenAt: contact.lastSeenAt,
      source: contact.source,
      subscriptionStatus: contact.subscriptionStatus,
      marketingConsentAt: contact.marketingConsentAt,
      lifecycleStage: computeLifecycle(contact, stats),
      pushEnabled: pushSubs > 0,
      pushDevices: pushSubs,
      tags: contact.tags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
    },
    stats,
    timeline,
    carts,
    emails,
    pushes,
    journeys,
    allTags,
    lastSuppressedAt: lastSuppression?.createdAt || null,
  };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const contactId = String(fd.get("contactId") || params.id);

  if (intent === "apply_tag") {
    const tagId = String(fd.get("tagId") || "");
    if (tagId) await applyTag(contactId, tagId);
    return { ok: true };
  }

  if (intent === "create_and_apply_tag") {
    const name = String(fd.get("name") || "").trim();
    if (name) await applyTagByName(shop, contactId, name);
    return { ok: true };
  }

  if (intent === "remove_tag") {
    const tagId = String(fd.get("tagId") || "");
    if (tagId) await removeTag(contactId, tagId);
    return { ok: true };
  }

  if (intent === "unsubscribe") {
    const contact = await getContactById(shop, contactId);
    if (contact) await unsubscribeContact(shop, contact.email);
    return { ok: true };
  }

  if (intent === "resubscribe") {
    const contact = await getContactById(shop, contactId);
    if (contact) await resubscribeContact(shop, contact.email);
    return { ok: true };
  }

  if (intent === "edit_name") {
    const name = String(fd.get("name") || "");
    await updateContactName(shop, contactId, name);
    return { ok: true };
  }

  if (intent === "delete") {
    await softDeleteContact(shop, contactId);
    return redirect("/app/contacts");
  }

  return { ok: false };
};

export default function ContactProfilePage() {
  const {
    contact,
    stats,
    timeline,
    carts,
    emails,
    pushes,
    journeys,
    allTags,
    lastSuppressedAt,
  } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [tab, setTab] = useState("timeline");
  const [kebab, setKebab] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(contact.name || "");

  const saveName = () => {
    const fd = new FormData();
    fd.set("intent", "edit_name");
    fd.set("name", nameDraft);
    fetcher.submit(fd, { method: "post" });
    setEditingName(false);
  };

  const submitIntent = (intent) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="rt-profile">
      <div className="rt-profile-bar">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate("/app/contacts")}
        >
          <Icons.ArrowBack size={14} /> All contacts
        </button>
        <div className="rt-profile-bar-right">
          <div className="rt-kebab-wrap">
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={() => setKebab(!kebab)}
              aria-label="More"
            >
              <Icons.More size={16} />
            </button>
            {kebab && (
              <>
                <div className="rt-veil" onClick={() => setKebab(false)} />
                <div className="rt-menu" style={{ right: 0, left: "auto" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setKebab(false);
                      setEditingName(true);
                    }}
                  >
                    <Icons.Type size={14} /> Edit name
                  </button>
                  {contact.subscriptionStatus === "subscribed" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setKebab(false);
                        submitIntent("unsubscribe");
                      }}
                    >
                      <Icons.Close size={14} /> Unsubscribe
                    </button>
                  ) : contact.subscriptionStatus === "unsubscribed" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setKebab(false);
                        submitIntent("resubscribe");
                      }}
                    >
                      <Icons.Check size={14} /> Re-subscribe
                    </button>
                  ) : null}
                  <div className="rt-menu-sep" />
                  <button
                    type="button"
                    className="rt-menu-danger"
                    onClick={() => {
                      if (window.confirm("Delete this contact?")) {
                        setKebab(false);
                        submitIntent("delete");
                      }
                    }}
                  >
                    <Icons.Trash size={14} /> Delete contact
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rt-profile-head">
        <div className="rt-profile-head-left">
          <Avatar name={contact.name} email={contact.email} size={88} />
          <div className="rt-profile-head-text">
            <div className="t-micro muted" style={{ marginBottom: 8 }}>
              Contact · First seen {relativeTime(contact.firstSeenAt)}
            </div>
            {editingName ? (
              <input
                className="input"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") {
                    setNameDraft(contact.name || "");
                    setEditingName(false);
                  }
                }}
                style={{ fontSize: 28, fontWeight: 600 }}
              />
            ) : (
              <h1 className="rt-profile-name">{contact.name || contact.email}</h1>
            )}
            {contact.name && <div className="rt-profile-email">{contact.email}</div>}
            <div className="rt-profile-pills">
              <StatusPill status={contact.subscriptionStatus} />
              <LifecyclePill stage={contact.lifecycleStage} />
              <span className="muted t-small">·</span>
              <span className="muted t-small">
                Last seen {relativeTime(contact.lastSeenAt)}
              </span>
            </div>
          </div>
        </div>
        <LifecycleJourney stage={contact.lifecycleStage} />
      </div>

      <SuppressionBanner
        contact={contact}
        lastSuppressedAt={lastSuppressedAt}
        onResubscribe={() => submitIntent("resubscribe")}
      />

      <div className="rt-profile-body">
        <div className="rt-profile-main">
          <div className="rt-mstats">
            <MiniStat
              label="Cart abandons"
              value={stats.cartAbandonCount}
              sub={
                stats.lastCartAbandonAt
                  ? `Last: ${relativeTime(stats.lastCartAbandonAt)}`
                  : "No carts yet"
              }
            />
            <MiniStat
              label="Last cart value"
              value={stats.lastCartValue ? fmtMoney(stats.lastCartValue) : "—"}
              sub={stats.cartAbandonCount ? "Most recent cart" : "Not enough data"}
            />
            <MiniStat
              label="Emails opened"
              value={`${stats.emailsOpened}/${stats.emailsSent}`}
              sub={fmtPctC(stats.openRate) + " open rate"}
            />
            <MiniStat
              label="Push clicks"
              value={stats.pushesClicked}
              sub={`${stats.pushesSent} sent`}
            />
          </div>

          <div className="rt-tabs">
            {[
              { id: "timeline", label: "Timeline", count: timeline.length },
              { id: "carts", label: "Carts", count: carts.length },
              { id: "emails", label: "Emails", count: emails.length },
              { id: "pushes", label: "Pushes", count: pushes.length },
            ].map((t) => (
              <button
                type="button"
                key={t.id}
                className={`rt-tab ${tab === t.id ? "rt-on" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span>{t.label}</span>
                <span className="rt-tab-count">{t.count}</span>
              </button>
            ))}
          </div>

          <div className="rt-tabbody">
            {tab === "timeline" && (
              timeline.length === 0 ? (
                <EmptyTab
                  icon="Bolt"
                  title="No activity yet"
                  body="Events will appear here as this contact engages with your store."
                />
              ) : (
                <div className="rt-timeline">
                  {timeline.map((ev, i) => (
                    <TimelineEvent
                      key={i}
                      event={ev}
                      last={i === timeline.length - 1}
                    />
                  ))}
                </div>
              )
            )}
            {tab === "carts" && <CartsTable rows={carts} />}
            {tab === "emails" && <EmailsTable rows={emails} />}
            {tab === "pushes" && <PushesTable rows={pushes} />}
          </div>
        </div>

        <aside className="rt-profile-rail">
          <TagsCard
            contactId={contact.id}
            contactTags={contact.tags}
            allTags={allTags}
          />
          <SubscriptionCard contact={contact} />
          <SegmentsCard />
          <JourneysCard active={journeys.active} past={journeys.past} />
          <CustomPropsCard />
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
