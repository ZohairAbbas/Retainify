// Two-step inline trigger picker.
//
// Step 1: vertical stack of trigger tiles (radio-card style). Picking any
//         non-segment trigger ends the interaction.
// Step 2: when "Entered a segment" is picked, a card slides in below with
//         either the empty-state prompt or the currently-selected segment.
//         Clicking "Pick" / "Change" replaces the card with a searchable
//         gallery of segments. Selecting one collapses back to the card.
//
// Drop-in for the previous <select> in the flow inspector. Also reused by
// the Create Flow modal's "Start blank" pathway.

import { useMemo, useState } from "react";
import { Link } from "react-router";
import Icons from "../ui/Icons.jsx";
import { TRIGGER_CONFIG } from "../../lib/triggerConfig.js";
import { relativeTime } from "../contacts/constants.js";

export default function TriggerPicker({
  value,
  segmentKey,
  segmentChoices = [],
  onChange,
  // When true, the picker hides the trigger description blurb. Used in the
  // Create Flow modal where space is tighter and the inspector intro text
  // would feel redundant.
  hideDescription = false,
  // Optional guard: when set, the picker calls this before navigating away
  // to a segment route. If it returns false, navigation is cancelled. Used
  // by the flow builder inspector to warn about unsaved draft changes.
  confirmLeave,
}) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const triggers = useMemo(
    () => Object.entries(TRIGGER_CONFIG).map(([id, cfg]) => ({ id, ...cfg })),
    [],
  );

  return (
    <div>
      <div className="rt-trig-tiles">
        {triggers.map((t) => {
          const Glyph = Icons[t.icon] || Icons.Trigger;
          const isOn = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`rt-trig-tile ${isOn ? "rt-on" : ""} ${t.id === "segment_entered" ? "rt-trig-tile-segment" : ""}`}
              onClick={() =>
                onChange(t.id, t.requiresSegment ? segmentKey || null : null)
              }
              title={t.desc}
            >
              <span className="rt-trig-tile-icon">
                <Glyph size={14} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="rt-trig-tile-name">{t.label}</span>
                <span className="rt-trig-tile-sub">{t.subLabel || ""}</span>
              </span>
              <span className="rt-trig-tile-check" />
            </button>
          );
        })}
      </div>

      {!hideDescription && (
        <div className="field-help" style={{ marginTop: 10 }}>
          {TRIGGER_CONFIG[value]?.desc}
        </div>
      )}

      {value === "segment_entered" && (
        <SegmentTriggerCard
          segmentKey={segmentKey}
          segmentChoices={segmentChoices}
          galleryOpen={galleryOpen}
          onOpenGallery={() => setGalleryOpen(true)}
          onCloseGallery={() => setGalleryOpen(false)}
          onPick={(key) => {
            onChange("segment_entered", key);
            setGalleryOpen(false);
          }}
          confirmLeave={confirmLeave}
        />
      )}
    </div>
  );
}

function SegmentTriggerCard({
  segmentKey,
  segmentChoices,
  galleryOpen,
  onOpenGallery,
  onCloseGallery,
  onPick,
  confirmLeave,
}) {
  const seg = segmentChoices.find((s) => s.key === segmentKey);
  // Guarded navigation helper — used for the destructive cross-route links
  // (View segment, + New, + Create new segment…).
  const guardedNav = (e, path) => {
    if (confirmLeave && !confirmLeave(path)) {
      e.preventDefault();
    }
  };

  if (galleryOpen) {
    return (
      <div className="rt-seg-pick">
        <div className="rt-seg-pick-head">
          <span className="t-micro">Pick a segment</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCloseGallery}
            style={{ padding: "4px 8px", height: 26 }}
          >
            <Icons.Close size={12} /> Cancel
          </button>
        </div>
        <SegmentGallery
          activeKey={segmentKey}
          segmentChoices={segmentChoices}
          onPick={onPick}
          confirmLeave={confirmLeave}
        />
      </div>
    );
  }

  return (
    <div className="rt-seg-pick">
      <div className="rt-seg-pick-head">
        <span className="t-micro">Segment</span>
        {seg && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onOpenGallery}
            style={{ padding: "4px 8px", height: 26 }}
          >
            <Icons.Refresh size={11} /> Change
          </button>
        )}
      </div>

      {!seg ? (
        <div className="rt-seg-pick-empty">
          <div className="rt-seg-pick-empty-lede">
            Anyone newly matching this segment enters the flow.{" "}
            <strong>Pick which segment</strong> to begin.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={onOpenGallery}
            >
              <Icons.Sliders size={13} /> Pick a segment
            </button>
            <Link
              className="btn btn-secondary"
              to="/app/segments/new"
              title="Create new segment"
              onClick={(e) => guardedNav(e, "/app/segments/new")}
            >
              <Icons.Plus size={13} /> New
            </Link>
          </div>
        </div>
      ) : (
        <div className="rt-seg-pick-card">
          <span className="rt-seg-pick-icon">
            <Icons.Venn size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="rt-seg-pick-info-top">
              <span className="rt-seg-pick-name">{seg.name}</span>
              <span className="rt-seg-pick-count">
                {seg.contactCount.toLocaleString()}
              </span>
            </div>
            {seg.description && (
              <div className="rt-seg-pick-rule">{seg.description}</div>
            )}
            <div className="rt-seg-pick-foot">
              <span>{seg.system ? "Built-in" : seg.kind === "dynamic" ? "Dynamic" : "Static"}</span>
              {seg.updatedAt && (
                <>
                  <span>·</span>
                  <span>Updated {relativeTime(seg.updatedAt)}</span>
                </>
              )}
              <Link
                to={`/app/segments/${seg.key}`}
                onClick={(e) => guardedNav(e, `/app/segments/${seg.key}`)}
              >
                View <Icons.Arrow size={9} />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentGallery({ activeKey, segmentChoices, onPick, confirmLeave }) {
  const [q, setQ] = useState("");
  const guardedNav = (e, path) => {
    if (confirmLeave && !confirmLeave(path)) {
      e.preventDefault();
    }
  };
  const items = useMemo(() => {
    if (!q) return segmentChoices;
    const lq = q.toLowerCase();
    return segmentChoices.filter((s) =>
      `${s.name} ${s.description || ""}`.toLowerCase().includes(lq),
    );
  }, [q, segmentChoices]);

  return (
    <div className="rt-seg-gallery">
      <div className="rt-seg-gallery-search">
        <div className="rt-search" style={{ width: "100%" }}>
          <Icons.Search size={13} />
          <input
            autoFocus
            placeholder="Search your segments…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="rt-seg-gallery-list">
        <Link
          className="rt-seg-gallery-create"
          to="/app/segments/new"
          style={{ textDecoration: "none" }}
          onClick={(e) => guardedNav(e, "/app/segments/new")}
        >
          <Icons.Plus size={13} /> Create new segment…
        </Link>
        {items.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`rt-seg-gallery-item ${activeKey === s.key ? "rt-on" : ""}`}
            onClick={() => onPick(s.key)}
          >
            <span className="rt-seg-gallery-item-icon">
              <Icons.Venn size={13} />
            </span>
            <span className="rt-seg-gallery-item-body">
              <span className="rt-seg-gallery-item-name">{s.name}</span>
              <span className="rt-seg-gallery-item-sub">
                {s.description || (s.system ? "Built-in audience" : "No description")}
              </span>
            </span>
            <span className="rt-seg-gallery-item-meta">
              {s.contactCount.toLocaleString()}
              <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>
                contacts
              </span>
            </span>
          </button>
        ))}
        {items.length === 0 && (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              fontSize: 12.5,
              color: "var(--ink-4)",
            }}
          >
            No segments match "{q}".
          </div>
        )}
      </div>
    </div>
  );
}
