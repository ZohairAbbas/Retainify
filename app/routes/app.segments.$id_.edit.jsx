import { useCallback, useMemo, useState } from "react";
import { redirect, useFetcher, useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import Icons from "../components/ui/Icons.jsx";
import SegmentBuilder from "../components/segments/SegmentBuilder.jsx";
import LivePreviewCard from "../components/segments/LivePreviewCard.jsx";
import { listTagsForShop } from "../lib/contacts/tags.server.js";
import { summarizeContacts } from "../lib/contacts/contacts.server.js";
import { getSegmentById, updateSegment, listStaticMemberIds } from "../lib/segments/segments.server.js";
import { isSystemSegmentId } from "../lib/segments/systemSegments.server.js";
import { FIELDS, OPERATORS } from "../lib/segments/fields.server.js";
import prisma from "../db.server.js";

export const loader = async ({ params, request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id;

  if (isSystemSegmentId(id)) {
    throw redirect(`/app/segments/${id}`);
  }
  const segment = await getSegmentById(shop, id);
  if (!segment) throw new Response("Not found", { status: 404 });

  let staticMembers = [];
  if (segment.kind === "static") {
    const memberIds = await listStaticMemberIds(segment.id);
    if (memberIds.length) {
      const rows = await prisma.contact.findMany({
        where: { id: { in: memberIds }, shop, deletedAt: null },
        select: { id: true, email: true, name: true },
      });
      staticMembers = rows;
    }
  }

  const [tags, summary] = await Promise.all([
    listTagsForShop(shop),
    summarizeContacts(shop),
  ]);

  return Response.json({
    segment,
    fields: FIELDS,
    operators: OPERATORS,
    tags,
    totalAudience: summary.total,
    initialStaticMembers: staticMembers,
  });
};

export const action = async ({ params, request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const id = params.id;

  const name = String(fd.get("name") || "").trim();
  const description = String(fd.get("description") || "").trim();
  const kind = String(fd.get("kind") || "dynamic");
  let filterTree = null;
  let memberContactIds = [];
  try { filterTree = JSON.parse(String(fd.get("filterTree") || "null")); } catch (_e) { filterTree = null; }
  try { memberContactIds = JSON.parse(String(fd.get("memberContactIds") || "[]")); } catch (_e) { memberContactIds = []; }

  if (!name) return Response.json({ ok: false, error: "Name is required" }, { status: 400 });

  try {
    await updateSegment(shop, id, { name, description, kind, filterTree });
    if (kind === "static") {
      // Replace static membership wholesale.
      await prisma.segmentMembership.deleteMany({ where: { segmentId: id } });
      if (memberContactIds.length) {
        await prisma.segmentMembership.createMany({
          data: memberContactIds.map((cid) => ({ segmentId: id, contactId: cid })),
          skipDuplicates: true,
        });
      }
    }
    return redirect(`/app/segments/${id}`);
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
};

export default function EditSegmentPage() {
  const { segment, fields, operators, tags, totalAudience, initialStaticMembers } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [draft, setDraft] = useState({
    name: segment.name,
    description: segment.description || "",
    kind: segment.kind,
    filterTree: segment.filterTree || { type: "group", match: "all", children: [] },
    staticMembers: initialStaticMembers,
  });

  const handleChange = useCallback((next) => setDraft(next), []);

  const canSave = useMemo(() => {
    if (!draft.name.trim()) return false;
    if (draft.kind === "dynamic") return (draft.filterTree?.children || []).length > 0;
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
              onClick={() => navigate(`/app/segments/${segment.id}`)}
              aria-label="Back"
            >
              <Icons.ArrowBack size={16} />
            </button>
            <span className="rt-bld-crumb">
              Segments / <span className="rt-bld-crumb-active">Editing</span>
            </span>
          </div>
          <div className="rt-bld-top-actions">
            <button type="button" className="btn btn-ghost" onClick={() => navigate(`/app/segments/${segment.id}`)}>
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
          initial={{
            name: segment.name,
            description: segment.description,
            kind: segment.kind,
            filterTree: segment.filterTree,
            staticMembers: initialStaticMembers,
          }}
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
