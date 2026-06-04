// Client-safe mirror of the segments field/operator catalog.
// The server is still the source of truth — loaders pass FIELDS down — but
// the builder needs quick lookups while the user types.

export const TYPE_DEFAULTS = {
  money:   { op: "gt", value: 100 },
  number:  { op: "gt", value: 100 },
  percent: { op: "gt", value: 20 },
  date:    { op: "in_last", value: 7, unit: "days" },
  enum:    { op: "is" },
  boolean: { op: "is_true", value: true },
  string:  { op: "is" },
  tag:     { op: "has" },
};

export function defaultRuleFor(field, firstTagId = null) {
  const base = { type: "rule", field: field.id };
  const def = TYPE_DEFAULTS[field.type] || {};
  const r = { ...base, ...def };
  if (field.type === "enum") r.value = field.options?.[0]?.id || "";
  if (field.type === "tag") r.value = firstTagId || "";
  return r;
}

export function emptyGroup(match = "all") {
  return { type: "group", match, children: [] };
}

// Format a rule value for read-only display.
export function formatRuleValue(rule, fieldsById, tagsById = {}) {
  const f = fieldsById[rule.field];
  if (!f) return String(rule.value ?? "");
  const v = rule.value;
  if (f.type === "money") {
    if (rule.op === "between") return `$${v?.[0] ?? 0} – $${v?.[1] ?? 0}`;
    return `$${Number(v ?? 0).toLocaleString()}`;
  }
  if (f.type === "number") {
    if (rule.op === "between") return `${v?.[0] ?? 0} – ${v?.[1] ?? 0}`;
    return String(v ?? 0);
  }
  if (f.type === "percent") {
    if (rule.op === "between") return `${v?.[0] ?? 0}% – ${v?.[1] ?? 0}%`;
    return `${v ?? 0}%`;
  }
  if (f.type === "date") {
    if (rule.op === "empty") return "";
    if (rule.op === "in_last" || rule.op === "more_than") return `${v ?? 0} ${rule.unit || "days"}`;
    return String(v ?? "");
  }
  if (f.type === "enum") {
    return f.options?.find((o) => o.id === v)?.label || String(v ?? "");
  }
  if (f.type === "boolean") return rule.op === "is_true" ? "yes" : "no";
  if (f.type === "tag") return tagsById[v]?.name || String(v ?? "");
  return String(v ?? "");
}
