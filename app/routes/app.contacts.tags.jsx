import { useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import Icons from "../components/ui/Icons.jsx";
import TagChip from "../components/contacts/TagChip.jsx";
import { TAG_PALETTE, relativeTime } from "../components/contacts/constants.js";
import {
  listTagsForShop,
  renameTag,
  recolorTag,
  deleteTag,
} from "../lib/contacts/tags.server.js";
import prisma from "../db.server.js";

const COLORS = ["forest", "blue", "amber", "purple", "tan", "red"];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const tags = await listTagsForShop(shop);
  // Pull createdAt for the table — listTagsForShop drops it.
  const meta = await prisma.tag.findMany({
    where: { shop },
    select: { id: true, createdAt: true },
  });
  const createdById = Object.fromEntries(meta.map((t) => [t.id, t.createdAt]));
  return Response.json({
    tags: tags.map((t) => ({ ...t, createdAt: createdById[t.id] || null })),
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const id = String(fd.get("id") || "");

  if (!id) return Response.json({ ok: false }, { status: 400 });

  try {
    if (intent === "rename") {
      const name = String(fd.get("name") || "").trim();
      if (!name) return Response.json({ ok: false, error: "Name is required" }, { status: 400 });
      await renameTag(shop, id, name);
      return Response.json({ ok: true });
    }
    if (intent === "recolor") {
      const color = String(fd.get("color") || "");
      await recolorTag(shop, id, color);
      return Response.json({ ok: true });
    }
    if (intent === "delete") {
      await deleteTag(shop, id);
      return Response.json({ ok: true });
    }
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 409 });
  }
  return Response.json({ ok: false }, { status: 400 });
};

export default function ManageTagsPage() {
  const { tags } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [openColorFor, setOpenColorFor] = useState(null);

  const submitRename = (id) => {
    const value = draft.trim();
    setEditingId(null);
    if (!value) return;
    const fd = new FormData();
    fd.set("intent", "rename");
    fd.set("id", id);
    fd.set("name", value);
    fetcher.submit(fd, { method: "post" });
  };
  const submitRecolor = (id, color) => {
    const fd = new FormData();
    fd.set("intent", "recolor");
    fd.set("id", id);
    fd.set("color", color);
    fetcher.submit(fd, { method: "post" });
    setOpenColorFor(null);
  };
  const submitDelete = (tag) => {
    const msg = tag.contactCount
      ? `Delete "${tag.name}"? It's applied to ${tag.contactCount} contact${tag.contactCount === 1 ? "" : "s"}; they'll lose this tag.`
      : `Delete "${tag.name}"?`;
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("intent", "delete");
    fd.set("id", tag.id);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate("/app/contacts")}
            style={{ marginBottom: 8 }}
          >
            <Icons.ArrowBack size={14} /> All contacts
          </button>
          <h1 className="t-display-2" style={{ margin: 0 }}>Manage tags</h1>
          <p className="t-body muted" style={{ margin: "8px 0 0", maxWidth: 540 }}>
            Rename, recolor, or delete tags. Deleting a tag removes it from every
            contact it's applied to, but the contacts themselves stay put.
          </p>
        </div>
      </header>

      <div className="rt-ctable">
        <div className="rt-cthead" style={{ gridTemplateColumns: "1.5fr 1fr 0.6fr 0.8fr 60px" }}>
          <div>Tag</div>
          <div>Color</div>
          <div className="rt-tnum">Contacts</div>
          <div>Created</div>
          <div />
        </div>
        {tags.length === 0 && (
          <div className="rt-empty-row">
            No tags yet. Create your first tag from a contact's profile or from the bulk-action bar.
          </div>
        )}
        {tags.map((t) => {
          const swatch = TAG_PALETTE[t.color] || TAG_PALETTE.forest;
          const isEditing = editingId === t.id;
          return (
            <div
              key={t.id}
              className="rt-ctrow"
              style={{ gridTemplateColumns: "1.5fr 1fr 0.6fr 0.8fr 60px", cursor: "default" }}
            >
              <div className="rt-cname" style={{ gap: 10 }}>
                <TagChip tag={t} />
                {isEditing ? (
                  <input
                    className="input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => submitRename(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    style={{ maxWidth: 240 }}
                  />
                ) : (
                  <button
                    type="button"
                    className="rt-link"
                    onClick={() => { setEditingId(t.id); setDraft(t.name); }}
                  >
                    Rename
                  </button>
                )}
              </div>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="rt-link"
                  onClick={() => setOpenColorFor(openColorFor === t.id ? null : t.id)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: swatch.bg,
                      border: "1px solid var(--hair-2)",
                    }}
                  />
                  <span style={{ textTransform: "capitalize" }}>{t.color}</span>
                </button>
                {openColorFor === t.id && (
                  <>
                    <div className="rt-veil" onClick={() => setOpenColorFor(null)} />
                    <div className="rt-menu" style={{ minWidth: 140 }}>
                      {COLORS.map((c) => {
                        const sw = TAG_PALETTE[c];
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => submitRecolor(t.id, c)}
                            style={{ display: "flex", alignItems: "center", gap: 8 }}
                          >
                            <span
                              style={{
                                display: "inline-block",
                                width: 14,
                                height: 14,
                                borderRadius: "50%",
                                background: sw.bg,
                                border: "1px solid var(--hair-2)",
                              }}
                            />
                            <span style={{ textTransform: "capitalize" }}>{c}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <div className="rt-tnum">
                <span className="t-mono">{t.contactCount.toLocaleString()}</span>
              </div>
              <div className="rt-tdate t-mono">{t.createdAt ? relativeTime(t.createdAt) : "—"}</div>
              <div className="rt-tactions">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => submitDelete(t)}
                  aria-label="Delete tag"
                  title="Delete"
                >
                  <Icons.Trash size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {fetcher.data?.error && (
        <div className="rt-prev-warn danger" style={{ marginTop: 12 }}>
          <Icons.Close size={14} />
          <div>
            <strong>Couldn't update tag.</strong>
            {fetcher.data.error}
          </div>
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
