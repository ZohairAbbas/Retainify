import { useCallback, useMemo, useState } from "react";
import { redirect, useFetcher, useLoaderData, useNavigate, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import Icons from "../components/ui/Icons.jsx";
import SegmentBuilder from "../components/segments/SegmentBuilder.jsx";
import LivePreviewCard from "../components/segments/LivePreviewCard.jsx";
import { listTagsForShop } from "../lib/contacts/tags.server.js";
import { summarizeContacts } from "../lib/contacts/contacts.server.js";
import { createSegment } from "../lib/segments/segments.server.js";
import { FIELDS, OPERATORS, TEMPLATES } from "../lib/segments/fields.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const templateId = url.searchParams.get("template");
  const fromFilters = url.searchParams.get("from") === "filters";

  let initial = null;
  if (templateId) {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    if (tpl) {
      initial = { name: tpl.name, description: tpl.description, kind: "dynamic", filterTree: tpl.rules };
    }
  } else if (fromFilters) {
    const children = [];
    const status = url.searchParams.get("status");
    const source = url.searchParams.get("source");
    const tag = url.searchParams.get("tag");
    if (status && status !== "all") children.push({ type: "rule", field: "subscriptionStatus", op: "is", value: status });
    if (source && source !== "all") children.push({ type: "rule", field: "source", op: "is", value: source });
    if (tag && tag !== "all") children.push({ type: "rule", field: "hasTag", op: "has", value: tag });
    if (children.length === 0) children.push({ type: "rule", field: "subscriptionStatus", op: "is", value: "subscribed" });
    initial = {
      name: "",
      description: "Saved from Contacts filters",
      kind: "dynamic",
      filterTree: { type: "group", match: "all", children },
    };
  }

  const [tags, summary] = await Promise.all([
    listTagsForShop(shop),
    summarizeContacts(shop),
  ]);

  return Response.json({
    fields: FIELDS,
    operators: OPERATORS,
    tags,
    initial,
    totalAudience: summary.total,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();

  const name = String(fd.get("name") || "").trim();
  const description = String(fd.get("description") || "").trim();
  const kind = String(fd.get("kind") || "dynamic");
  let filterTree = null;
  let memberContactIds = [];
  try {
    filterTree = JSON.parse(String(fd.get("filterTree") || "null"));
  } catch (_e) {
    filterTree = null;
  }
  try {
    memberContactIds = JSON.parse(String(fd.get("memberContactIds") || "[]"));
  } catch (_e) {
    memberContactIds = [];
  }

  if (!name) {
    return Response.json({ ok: false, error: "Name is required" }, { status: 400 });
  }

  try {
    const seg = await createSegment(shop, { name, description, kind, filterTree, memberContactIds });
    return redirect(`/app/segments/${seg.id}`);
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
};

export default function NewSegmentPage() {
  const { fields, operators, tags, initial, totalAudience } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [draft, setDraft] = useState({
    name: initial?.name || "",
    description: initial?.description || "",
    kind: initial?.kind || "dynamic",
    filterTree: initial?.filterTree || { type: "group", match: "all", children: [] },
    staticMembers: [],
  });

  const handleChange = useCallback((next) => setDraft(next), []);

  const canSave = useMemo(() => {
    if (!draft.name.trim()) return false;
    if (draft.kind === "dynamic") {
      return (draft.filterTree?.children || []).length > 0;
    }
    return draft.staticMembers.length > 0;
  }, [draft]);

  const onSave = () => {
    const fd = new FormData();
    fd.set("name", draft.name);
    fd.set("description", draft.description);
    fd.set("kind", draft.kind);
    fd.set("filterTree", JSON.stringify(draft.kind === "dynamic" ? draft.filterTree : null));
    fd.set("memberContactIds", JSON.stringify(draft.staticMembers.map((m) => m.id)));
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="rt-bld">
      <div className="rt-bld-main">
        <div className="rt-bld-top">
          <div className="rt-bld-top-left">
            <button
              type="button"
              className="rt-bld-back"
              onClick={() => navigate("/app/segments")}
              aria-label="Back"
            >
              <Icons.ArrowBack size={16} />
            </button>
            <span className="rt-bld-crumb">
              Segments / <span className="rt-bld-crumb-active">{params.get("template") ? "From template" : "New segment"}</span>
            </span>
          </div>
          <div className="rt-bld-top-actions">
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/app/segments")}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={!canSave || fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? "Saving…" : "Save segment"}
            </button>
          </div>
        </div>

        <SegmentBuilder
          initial={initial || draft}
          fields={fields}
          operators={operators}
          tags={tags}
          onChange={handleChange}
        />

        {fetcher.data?.error && (
          <div className="rt-prev-warn danger" style={{ marginTop: 16 }}>
            <Icons.Close size={14} />
            <div>
              <strong>Couldn't save segment.</strong>
              {fetcher.data.error}
            </div>
          </div>
        )}
      </div>
      <div className="rt-bld-side">
        <LivePreviewCard
          filterTree={draft.filterTree}
          kind={draft.kind}
          staticMembers={draft.staticMembers}
          totalAudience={totalAudience}
        />
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
