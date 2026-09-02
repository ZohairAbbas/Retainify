import { useEffect, useMemo, useState } from "react";
import Icons from "../ui/Icons.jsx";
import { emptyGroup } from "./constants.js";
// The rule-tree editor is shared with flow entry filters — see FilterTree.jsx
// for why there is exactly one implementation of it.
import { GroupBlock } from "./FilterTree.jsx";

// ── Builder shell ─────────────────────────────────────────────────────
export default function SegmentBuilder({
  initial,
  fields,
  operators,
  tags,
  onChange,
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [kind, setKind] = useState(initial?.kind || "dynamic");
  const [tree, setTree] = useState(
    initial?.filterTree && initial.filterTree.children
      ? initial.filterTree
      : emptyGroup("all"),
  );
  const [staticMembers, setStaticMembers] = useState(initial?.staticMembers || []);

  const fieldsById = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.id, f])),
    [fields],
  );

  useEffect(() => {
    onChange?.({ name, description, kind, filterTree: tree, staticMembers });
  }, [name, description, kind, tree, staticMembers, onChange]);

  return (
    <div className="rt-bld-main">
      {/* Section 1 — Basics */}
      <div className="rt-bld-card">
        <div className="rt-bld-card-head">
          <span className="rt-bld-card-num">1</span>
          <span className="t-micro">The basics</span>
          <span className="rt-bld-card-rule" />
        </div>
        <div className="rt-bld-basics">
          <label>
            <div className="field-label">Segment name</div>
            <input
              className="input"
              placeholder="e.g. VIP buyers in California"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <div className="field-label">Short description (optional)</div>
            <input
              className="input"
              placeholder="What's the purpose of this group?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="field-label">Type</div>
          <div className="rt-typ-toggle">
            <button
              type="button"
              className={`rt-typ-opt ${kind === "dynamic" ? "rt-on" : ""}`}
              onClick={() => setKind("dynamic")}
            >
              <span className="rt-typ-radio" />
              <span>
                <div className="rt-typ-name">Dynamic — updates itself</div>
                <div className="rt-typ-desc">
                  Contacts move in and out as their data changes. Use for flows and ongoing campaigns.
                </div>
              </span>
            </button>
            <button
              type="button"
              className={`rt-typ-opt ${kind === "static" ? "rt-on" : ""}`}
              onClick={() => setKind("static")}
            >
              <span className="rt-typ-radio" />
              <span>
                <div className="rt-typ-name">Static — frozen list</div>
                <div className="rt-typ-desc">
                  A snapshot you build manually. Useful for one-off lists like event RSVPs.
                </div>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 2 — Rules / Members */}
      <div className="rt-bld-card">
        <div className="rt-bld-card-head">
          <span className="rt-bld-card-num">2</span>
          <span className="t-micro">
            {kind === "dynamic" ? "Rules" : "Members"}
          </span>
          <span className="rt-bld-card-rule" />
        </div>
        {kind === "dynamic" ? (
          <GroupBlock
            node={tree}
            depth={0}
            fields={fields}
            fieldsById={fieldsById}
            operators={operators}
            tags={tags}
            onChange={setTree}
            onRemove={() => {}}
            canRemove={false}
          />
        ) : (
          <StaticMembers
            members={staticMembers}
            onChange={setStaticMembers}
          />
        )}
      </div>
    </div>
  );
}

// ── Static members editor ─────────────────────────────────────────────
function StaticMembers({ members, onChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const url = `/app/contacts?q=${encodeURIComponent(q.trim())}&_data=1`;
        // The contacts route doesn't expose a JSON-only endpoint, so we
        // simply leave the results to the dedicated search action below.
        // Lookup is wired through the segments search endpoint instead.
        const res = await fetch(`/app/segments/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.contacts || []);
        }
        void url;
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const add = (c) => {
    if (members.some((m) => m.id === c.id)) return;
    onChange([...members, c]);
    setQ("");
    setResults([]);
  };
  const remove = (id) => onChange(members.filter((m) => m.id !== id));

  return (
    <div>
      <div className="rt-stm-add">
        <div className="rt-search" style={{ flex: 1 }}>
          <Icons.Search size={14} />
          <input
            placeholder="Search to add contacts by email or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {results.length > 0 && (
        <div className="rt-sel-menu" style={{ position: "static", boxShadow: "none", marginBottom: 12 }}>
          {results.map((r) => (
            <button
              type="button"
              key={r.id}
              className="rt-sel-item"
              onClick={() => add(r)}
            >
              <span style={{ fontWeight: 500 }}>{r.email}</span>
              {r.name && <span style={{ color: "var(--ink-3)", marginLeft: 8 }}>· {r.name}</span>}
            </button>
          ))}
        </div>
      )}
      {loading && <div className="t-small muted" style={{ marginBottom: 12 }}>Searching…</div>}

      {members.length === 0 ? (
        <div className="rt-stm-empty">
          No contacts in this segment yet. Search above to add some.
        </div>
      ) : (
        <div className="rt-stm-list">
          {members.map((m) => (
            <div className="rt-stm-row" key={m.id}>
              <Icons.Mail size={14} />
              <div className="rt-cname-email">
                {m.email}
                {m.name && <span style={{ color: "var(--ink-3)" }}>  ·  {m.name}</span>}
              </div>
              <button
                type="button"
                className="rt-rule-x"
                onClick={() => remove(m.id)}
                aria-label="Remove member"
              >
                <Icons.Close size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="rt-stm-bulk">
        <Icons.Sparkles size={14} />
        <span>{members.length} contact{members.length === 1 ? "" : "s"} in this segment.</span>
      </div>
    </div>
  );
}
