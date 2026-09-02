import { useEffect, useMemo, useRef, useState } from "react";
import Icons from "../ui/Icons.jsx";
import SoonPill from "../contacts/SoonPill.jsx";
import { TAG_PALETTE } from "../contacts/constants.js";
import { defaultRuleFor, emptyGroup } from "./constants.js";

/**
 * The rule-tree editor, shared by the segment builder and flow entry filters.
 *
 * Both surfaces edit the same structure — a root group of rules and nested
 * groups, evaluated by the same `evalTreeForContact` on the server — so they
 * must offer the same operators, the same value controls and the same nesting
 * behaviour. Two copies would drift, and a rule that renders one way in
 * segments and another in flows is a bug the merchant discovers, not us.
 *
 * `GroupBlock` is the whole public surface: give it a group node and it renders
 * the tree beneath it. What differs between the two callers is only which
 * `fields` they pass — segments include gated fields with a Soon pill, flows
 * pass only fields that actually evaluate, because a no-op rule in a segment
 * shows a slightly wrong count while a no-op rule in a flow filter sends mail
 * to people the merchant excluded.
 */

// ── Dropdown ──────────────────────────────────────────────────────────
function Dropdown({ value, label, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div ref={ref} className="rt-sel-menu" role="listbox" aria-label={label}>
      {children}
    </div>
  );
}

function FieldPicker({ fields, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = fields.find((f) => f.id === value);
  const grouped = useMemo(() => {
    const m = new Map();
    for (const f of fields) {
      const arr = m.get(f.group) || [];
      arr.push(f);
      m.set(f.group, arr);
    }
    return Array.from(m.entries());
  }, [fields]);
  return (
    <div className="rt-sel">
      <button
        type="button"
        className={`rt-sel-btn ${current ? "" : "rt-empty"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? current.label : "Pick a field…"}
      </button>
      {open && (
        <Dropdown label="Field" onClose={() => setOpen(false)}>
          {grouped.map(([group, items]) => (
            <div key={group}>
              <div className="rt-sel-group-label">{group}</div>
              {items.map((f) => {
                const isOn = f.id === value;
                const disabled = !f.supported;
                return (
                  <button
                    type="button"
                    key={f.id}
                    className={`rt-sel-item ${isOn ? "rt-on" : ""}`}
                    onClick={() => {
                      if (disabled) return;
                      onChange(f);
                      setOpen(false);
                    }}
                    style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                    title={disabled ? "Coming soon" : undefined}
                  >
                    <span style={{ flex: 1 }}>{f.label}</span>
                    {disabled && <SoonPill />}
                  </button>
                );
              })}
            </div>
          ))}
        </Dropdown>
      )}
    </div>
  );
}

function OperatorPicker({ ops, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = ops.find((o) => o.id === value);
  return (
    <div className="rt-sel">
      <button
        type="button"
        className={`rt-sel-btn ${current ? "" : "rt-empty"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? current.label : "Pick an operator…"}
      </button>
      {open && (
        <Dropdown label="Operator" onClose={() => setOpen(false)}>
          {ops.map((o) => (
            <button
              type="button"
              key={o.id}
              className={`rt-sel-item ${o.id === value ? "rt-on" : ""}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </Dropdown>
      )}
    </div>
  );
}

function EnumPicker({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <div className="rt-sel">
      <button
        type="button"
        className={`rt-sel-btn ${current ? "" : "rt-empty"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? current.label : "Pick a value…"}
      </button>
      {open && (
        <Dropdown label="Value" onClose={() => setOpen(false)}>
          {options.map((o) => (
            <button
              type="button"
              key={o.id}
              className={`rt-sel-item ${o.id === value ? "rt-on" : ""}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </Dropdown>
      )}
    </div>
  );
}

function TagPicker({ tags, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = tags.find((t) => t.id === value);
  return (
    <div className="rt-sel">
      <button
        type="button"
        className={`rt-sel-btn ${current ? "" : "rt-empty"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? (
          <>
            <span
              className="rt-sel-tag-swatch"
              style={{ background: TAG_PALETTE[current.color]?.bg || "var(--paper-2)" }}
            />
            {current.name}
          </>
        ) : (
          "Pick a tag…"
        )}
      </button>
      {open && (
        <Dropdown label="Tag" onClose={() => setOpen(false)}>
          {tags.length === 0 && (
            <div className="rt-sel-group-label">No tags yet</div>
          )}
          {tags.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`rt-sel-item ${t.id === value ? "rt-on" : ""}`}
              onClick={() => {
                onChange(t.id);
                setOpen(false);
              }}
            >
              <span
                className="rt-sel-tag-swatch"
                style={{ background: TAG_PALETTE[t.color]?.bg || "var(--paper-2)" }}
              />
              {t.name}
            </button>
          ))}
        </Dropdown>
      )}
    </div>
  );
}

function ValueControl({ field, rule, onChange, tags }) {
  if (!field) return null;
  const set = (patch) => onChange({ ...rule, ...patch });
  switch (field.type) {
    case "money":
    case "number": {
      if (rule.op === "between") {
        const v = Array.isArray(rule.value) ? rule.value : [0, 100];
        return (
          <div className="rt-val rt-val-between">
            <input
              className="input"
              type="number"
              value={v[0] ?? 0}
              onChange={(e) => set({ value: [Number(e.target.value), v[1]] })}
            />
            <span className="rt-val-suffix">and</span>
            <input
              className="input"
              type="number"
              value={v[1] ?? 0}
              onChange={(e) => set({ value: [v[0], Number(e.target.value)] })}
            />
          </div>
        );
      }
      return (
        <div className="rt-val">
          {field.type === "money" && <span className="rt-val-prefix">$</span>}
          <input
            className="input"
            type="number"
            value={rule.value ?? 0}
            onChange={(e) => set({ value: Number(e.target.value) })}
          />
        </div>
      );
    }
    case "percent": {
      if (rule.op === "between") {
        const v = Array.isArray(rule.value) ? rule.value : [0, 100];
        return (
          <div className="rt-val rt-val-between">
            <input
              className="input"
              type="number"
              value={v[0] ?? 0}
              onChange={(e) => set({ value: [Number(e.target.value), v[1]] })}
            />
            <span className="rt-val-suffix">and</span>
            <input
              className="input"
              type="number"
              value={v[1] ?? 0}
              onChange={(e) => set({ value: [v[0], Number(e.target.value)] })}
            />
          </div>
        );
      }
      return (
        <div className="rt-val">
          <input
            className="input"
            type="number"
            value={rule.value ?? 0}
            onChange={(e) => set({ value: Number(e.target.value) })}
          />
          <span className="rt-val-suffix">%</span>
        </div>
      );
    }
    case "date": {
      if (rule.op === "empty") {
        return <div className="rt-val"><span className="rt-val-suffix">—</span></div>;
      }
      if (rule.op === "in_last" || rule.op === "more_than") {
        return (
          <div className="rt-val">
            <input
              className="input"
              type="number"
              min={1}
              value={rule.value ?? 7}
              onChange={(e) => set({ value: Number(e.target.value) })}
              style={{ width: 70 }}
            />
            <span className="rt-val-suffix">{rule.unit || "days"}</span>
          </div>
        );
      }
      return (
        <div className="rt-val">
          <input
            className="input"
            type="date"
            value={typeof rule.value === "string" ? rule.value.slice(0, 10) : ""}
            onChange={(e) => set({ value: e.target.value })}
          />
        </div>
      );
    }
    case "enum": {
      return (
        <ValueControlEnum field={field} rule={rule} onChange={onChange} />
      );
    }
    case "boolean":
      return <div className="rt-val"><span className="rt-val-suffix">—</span></div>;
    case "tag":
      return (
        <TagPicker
          tags={tags}
          value={rule.value}
          onChange={(v) => set({ value: v })}
        />
      );
    default:
      return null;
  }
}

function ValueControlEnum({ field, rule, onChange }) {
  return (
    <EnumPicker
      options={field.options || []}
      value={rule.value}
      onChange={(v) => onChange({ ...rule, value: v })}
    />
  );
}

// ── Rule + Group ──────────────────────────────────────────────────────
function RuleRow({ idx, rule, fields, fieldsById, operators, tags, onChange, onRemove }) {
  const field = fieldsById[rule.field];
  const ops = field ? operators[field.type] || [] : [];
  return (
    <div className="rt-rule">
      <div className="rt-rule-num">{String(idx + 1).padStart(2, "0")}</div>
      <FieldPicker
        fields={fields}
        value={rule.field}
        onChange={(f) => onChange(defaultRuleFor(f, tags?.[0]?.id || null))}
      />
      <OperatorPicker
        ops={ops}
        value={rule.op}
        onChange={(opId) => onChange({ ...rule, op: opId })}
      />
      <ValueControl field={field} rule={rule} onChange={onChange} tags={tags} />
      <button
        type="button"
        className="rt-rule-x"
        onClick={onRemove}
        aria-label="Remove rule"
      >
        <Icons.Close size={14} />
      </button>
    </div>
  );
}

export function GroupBlock({
  node,
  depth = 0,
  fields,
  fieldsById,
  operators,
  tags,
  onChange,
  onRemove,
  canRemove,
}) {
  const isAny = node.match === "any";
  const setMatch = (m) => onChange({ ...node, match: m });
  const setChild = (i, child) => {
    const next = node.children.slice();
    next[i] = child;
    onChange({ ...node, children: next });
  };
  const removeChild = (i) => {
    const next = node.children.slice();
    next.splice(i, 1);
    onChange({ ...node, children: next });
  };
  const addRule = () => {
    const f = fields.find((x) => x.supported) || fields[0];
    onChange({ ...node, children: [...node.children, defaultRuleFor(f, tags?.[0]?.id || null)] });
  };
  const addGroup = () => {
    onChange({
      ...node,
      children: [...node.children, emptyGroup(isAny ? "all" : "any")],
    });
  };

  return (
    <div
      className={
        "rt-grp" +
        (depth > 0 ? " rt-grp-sub" + (isAny ? " rt-any-rail" : "") : "")
      }
    >
      <div className={`rt-grp-head ${isAny ? "rt-any" : ""}`}>
        <span className="rt-grp-label">Match</span>
        <div className="rt-grp-toggle">
          <button
            type="button"
            className={!isAny ? "rt-on" : ""}
            onClick={() => setMatch("all")}
          >
            All
          </button>
          <button
            type="button"
            className={isAny ? "rt-on" : ""}
            onClick={() => setMatch("any")}
          >
            Any
          </button>
        </div>
        <span className="rt-grp-of">
          ({node.children.length} rule{node.children.length === 1 ? "" : "s"})
        </span>
        <span className="rt-grp-spacer" />
        {canRemove && (
          <button
            type="button"
            className="rt-grp-remove"
            onClick={onRemove}
            aria-label="Remove group"
          >
            <Icons.Trash size={14} />
          </button>
        )}
      </div>
      <div className="rt-grp-body">
        {node.children.length === 0 && (
          <div className="rt-stm-empty" style={{ marginBottom: 12 }}>
            No rules yet. Add one below to begin matching contacts.
          </div>
        )}
        {node.children.map((child, i) => {
          const isFirst = i === 0;
          return (
            <div key={i}>
              {!isFirst && (
                <div className="rt-grp-conn">
                  <span className="rt-grp-conn-word">{isAny ? "or" : "and"}</span>
                  <span className="rt-grp-conn-line" />
                </div>
              )}
              {child.type === "rule" ? (
                <RuleRow
                  idx={i}
                  rule={child}
                  fields={fields}
                  fieldsById={fieldsById}
                  operators={operators}
                  tags={tags}
                  onChange={(next) => setChild(i, next)}
                  onRemove={() => removeChild(i)}
                />
              ) : (
                <GroupBlock
                  node={child}
                  depth={depth + 1}
                  fields={fields}
                  fieldsById={fieldsById}
                  operators={operators}
                  tags={tags}
                  onChange={(next) => setChild(i, next)}
                  onRemove={() => removeChild(i)}
                  canRemove
                />
              )}
            </div>
          );
        })}
        <div className="rt-grp-add-row">
          <button type="button" className="rt-add-btn" onClick={addRule}>
            <Icons.Plus size={12} /> Add rule
          </button>
          {depth === 0 && (
            <button type="button" className="rt-add-btn rt-add-btn-sub" onClick={addGroup}>
              <Icons.Plus size={12} /> Add sub-group ({isAny ? "AND" : "OR"})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
