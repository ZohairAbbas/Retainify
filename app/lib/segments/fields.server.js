// Segments — field + operator catalog.
//
// Source of truth for the rule builder. Ported from the prototype's
// segmentsdata.jsx, with a `supported` flag layered on top:
//   - true  → backend can evaluate it in v1.
//   - false → rendered but disabled with a "Soon" chip (no order data /
//             per-event engagement timestamps yet).
//
// The list is exported to the client through route loaders so the builder
// UI shows the exact same field set the server is willing to validate.

export const FIELDS = [
  // Purchase — gated (no order ingestion yet)
  { id: "totalSpent",        label: "Total spent",         group: "Purchase",         type: "money",   supported: false },
  { id: "orderCount",        label: "Order count",         group: "Purchase",         type: "number",  supported: false },
  { id: "lastOrderAt",       label: "Last order date",     group: "Purchase",         type: "date",    supported: false },
  { id: "aov",               label: "Average order value", group: "Purchase",         type: "money",   supported: false },

  // Cart — supported via AbandonedCart aggregate
  { id: "cartAbandonCount",  label: "Abandoned cart count", group: "Cart",            type: "number",  supported: true },
  { id: "lastCartAt",        label: "Last cart abandoned",  group: "Cart",            type: "date",    supported: true },
  { id: "lastCartValue",     label: "Last cart value",      group: "Cart",            type: "money",   supported: true },
  { id: "hasActiveCart",     label: "Has an active cart",   group: "Cart",            type: "boolean", supported: true },

  // Email engagement — counts supported via JourneyJob; rates / last-opened
  // need per-event timestamps that aren't stored yet.
  { id: "emailsSent",        label: "Emails sent",         group: "Email engagement", type: "number",  supported: true },
  { id: "emailsOpened",      label: "Emails opened",       group: "Email engagement", type: "number",  supported: true },
  { id: "openRate",          label: "Open rate",           group: "Email engagement", type: "percent", supported: false },
  { id: "emailsClicked",     label: "Emails clicked",      group: "Email engagement", type: "number",  supported: true },
  { id: "clickRate",         label: "Click rate",          group: "Email engagement", type: "percent", supported: false },
  { id: "lastEmailOpenedAt", label: "Last email opened",   group: "Email engagement", type: "date",    supported: false },

  // Profile — all live
  { id: "subscriptionStatus", label: "Subscription status", group: "Profile", type: "enum", supported: true,
    options: [
      { id: "subscribed",     label: "Subscribed" },
      { id: "unsubscribed",   label: "Unsubscribed" },
      { id: "bounced",        label: "Bounced" },
      { id: "complained",     label: "Complained" },
      { id: "never_opted_in", label: "Never opted in" },
    ] },
  { id: "lifecycleStage",     label: "Lifecycle stage",     group: "Profile", type: "enum", supported: true,
    options: [
      { id: "new",             label: "New" },
      { id: "active",          label: "Active" },
      { id: "at_risk",         label: "At-risk" },
      { id: "churned",         label: "Churned" },
      { id: "never_purchased", label: "Never purchased" },
    ] },
  { id: "source",             label: "Source",              group: "Profile", type: "enum", supported: true,
    options: [
      { id: "popup",            label: "Popup" },
      { id: "cart_abandoned",   label: "Abandoned cart" },
      { id: "shopify_customer", label: "Shopify customer" },
      { id: "csv_import",       label: "CSV import" },
      { id: "push_only",        label: "Push only" },
      { id: "manual",           label: "Added manually" },
    ] },
  { id: "hasTag",         label: "Has tag",     group: "Profile", type: "tag",     supported: true },
  { id: "firstSeenAt",    label: "First seen",  group: "Profile", type: "date",    supported: true },
  { id: "lastSeenAt",     label: "Last seen",   group: "Profile", type: "date",    supported: true },
  { id: "pushEnabled",    label: "Push enabled", group: "Profile", type: "boolean", supported: false },
];

export const FIELD_BY_ID = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

export const OPERATORS = {
  money:   [{ id: "gt", label: "is more than" }, { id: "lt", label: "is less than" }, { id: "eq", label: "is exactly" }, { id: "between", label: "is between" }],
  number:  [{ id: "gt", label: "is more than" }, { id: "lt", label: "is less than" }, { id: "eq", label: "is exactly" }, { id: "between", label: "is between" }],
  percent: [{ id: "gt", label: "is more than" }, { id: "lt", label: "is less than" }, { id: "between", label: "is between" }],
  date:    [{ id: "in_last", label: "in the last" }, { id: "more_than", label: "more than" }, { id: "before", label: "is before" }, { id: "after", label: "is after" }, { id: "empty", label: "is empty" }],
  enum:    [{ id: "is", label: "is" }, { id: "is_not", label: "is not" }, { id: "is_one_of", label: "is one of" }],
  boolean: [{ id: "is_true", label: "is true" }, { id: "is_false", label: "is false" }],
  string:  [{ id: "is", label: "is" }, { id: "is_not", label: "is not" }, { id: "contains", label: "contains" }, { id: "empty", label: "is empty" }],
  tag:     [{ id: "has", label: "is" }, { id: "has_not", label: "is not" }, { id: "has_any", label: "is any of" }],
};

export function isSupportedField(fieldId) {
  return Boolean(FIELD_BY_ID[fieldId]?.supported);
}

export function defaultOpFor(fieldId) {
  const f = FIELD_BY_ID[fieldId];
  if (!f) return "is";
  if (f.type === "date") return "in_last";
  if (f.type === "boolean") return "is_true";
  return (OPERATORS[f.type] || [{ id: "is" }])[0].id;
}

export function defaultValueFor(fieldId, firstTagId = null) {
  const f = FIELD_BY_ID[fieldId];
  if (!f) return "";
  if (f.type === "money" || f.type === "number") return 100;
  if (f.type === "percent") return 20;
  if (f.type === "date") return 7;
  if (f.type === "enum") return f.options?.[0]?.id || "";
  if (f.type === "boolean") return true;
  if (f.type === "tag") return firstTagId || "";
  return "";
}

// ── Templates (used by the segments list empty state + "Use template") ───
export const TEMPLATES = [
  {
    id: "tpl_bigspend",
    name: "Big spenders",
    description: "Customers who've spent over $200 lifetime",
    icon: "Heart",
    accent: "#DCE7DF",
    accentInk: "#1F3D2F",
    rules: { type: "group", match: "all", children: [{ type: "rule", field: "totalSpent", op: "gt", value: 200 }] },
  },
  {
    id: "tpl_cart",
    name: "Recent cart abandoners",
    description: "Abandoned a cart in the last 7 days",
    icon: "Cart",
    accent: "#F1E4C5",
    accentInk: "#6B5018",
    rules: { type: "group", match: "all", children: [{ type: "rule", field: "lastCartAt", op: "in_last", value: 7, unit: "days" }] },
  },
  {
    id: "tpl_engaged",
    name: "Engaged but never bought",
    description: "Opened 3+ emails, no orders yet",
    icon: "Eye",
    accent: "#DCE4ED",
    accentInk: "#25406A",
    rules: { type: "group", match: "all", children: [
      { type: "rule", field: "emailsOpened", op: "gt", value: 3 },
      { type: "rule", field: "orderCount", op: "eq", value: 0 },
    ] },
  },
  {
    id: "tpl_winback",
    name: "Win-back candidates",
    description: "At-risk lifecycle with prior order over $100",
    icon: "Clock",
    accent: "#EAD6EA",
    accentInk: "#5A2E5A",
    rules: { type: "group", match: "all", children: [
      { type: "rule", field: "lifecycleStage", op: "is", value: "at_risk" },
      { type: "rule", field: "totalSpent", op: "gt", value: 100 },
    ] },
  },
];
