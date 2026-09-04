// Segments — field + operator catalog.
//
// Source of truth for the rule builder. Ported from the prototype's
// segmentsdata.jsx, with a `supported` flag layered on top:
//   - true  → backend can evaluate it.
//   - false → rendered but disabled with a "Soon" chip.
//
// Everything in the catalog is supported today. The flag stays because a field
// can only ever reach the picker before the data behind it exists, and the
// alternative — offering a field that quietly matches everyone — is the bug
// this file spent its first two versions shipping.
//
// The list is exported to the client through route loaders so the builder
// UI shows the exact same field set the server is willing to validate.

export const FIELDS = [
  // Purchase — backed by the Order table and the aggregates denormalized onto
  // Contact (see lib/orders/orders.server.js). totalSpent, orderCount and
  // lastOrderAt are real columns, so they evaluate in SQL; AOV is derived from
  // two of them and is computed in JS.
  { id: "totalSpent",        label: "Total spent",         group: "Purchase",         type: "money",   supported: true },
  { id: "orderCount",        label: "Order count",         group: "Purchase",         type: "number",  supported: true },
  { id: "lastOrderAt",       label: "Last order date",     group: "Purchase",         type: "date",    supported: true },
  { id: "aov",               label: "Average order value", group: "Purchase",         type: "money",   supported: true },

  // Cart — supported via AbandonedCart aggregate
  { id: "cartAbandonCount",  label: "Abandoned cart count", group: "Cart",            type: "number",  supported: true },
  { id: "lastCartAt",        label: "Last cart abandoned",  group: "Cart",            type: "date",    supported: true },
  { id: "lastCartValue",     label: "Last cart value",      group: "Cart",            type: "money",   supported: true },
  { id: "hasActiveCart",     label: "Has an active cart",   group: "Cart",            type: "boolean", supported: true },

  // Email engagement — all backed by aggregates denormalized onto Contact (see
  // lib/contacts/engagement.server.js). The rates and last-opened were gated
  // while they were a live join over JourneyJob, which the evaluator could only
  // run inside its capped JS scan; as columns they compare in SQL.
  //
  // A rate rule never matches a contact with an empty denominator — no sends
  // means no rate, not a rate of zero. The evaluator carries the reasoning.
  { id: "emailsSent",        label: "Emails sent",         group: "Email engagement", type: "number",  supported: true },
  { id: "emailsOpened",      label: "Emails opened",       group: "Email engagement", type: "number",  supported: true },
  { id: "openRate",          label: "Open rate",           group: "Email engagement", type: "percent", supported: true },
  { id: "emailsClicked",     label: "Emails clicked",      group: "Email engagement", type: "number",  supported: true },
  { id: "clickRate",         label: "Click rate",          group: "Email engagement", type: "percent", supported: true },
  { id: "lastEmailOpenedAt", label: "Last email opened",   group: "Email engagement", type: "date",    supported: true },

  // Profile — all live
  { id: "subscriptionStatus", label: "Subscription status", group: "Profile", type: "enum", supported: true,
    options: [
      { id: "subscribed",     label: "Subscribed" },
      { id: "unsubscribed",   label: "Unsubscribed" },
      { id: "bounced",        label: "Bounced" },
      { id: "complained",     label: "Complained" },
      { id: "never_opted_in", label: "Never opted in" },
    ] },
  // The WhatsApp consent state, mirroring subscriptionStatus for email. Meta
  // requires opt-in before messaging, so "who may I actually reach on
  // WhatsApp" is a targeting question in its own right — without this a
  // merchant building a WhatsApp flow can only guess at its audience.
  { id: "whatsappStatus",     label: "WhatsApp status",     group: "Profile", type: "enum", supported: true,
    options: [
      { id: "subscribed",     label: "Subscribed" },
      { id: "unsubscribed",   label: "Unsubscribed" },
      { id: "invalid",        label: "Invalid number" },
      { id: "never_opted_in", label: "Never opted in" },
    ] },
  { id: "lifecycleStage",     label: "Lifecycle stage",     group: "Profile", type: "enum", supported: true,
    options: [
      { id: "new",             label: "New" },
      { id: "active",          label: "Active" },
      { id: "at_risk",         label: "At-risk" },
      { id: "churned",         label: "Churned" },
    ] },
  { id: "source",             label: "Source",              group: "Profile", type: "enum", supported: true,
    options: [
      { id: "popup",            label: "Popup" },
      { id: "cart_abandoned",   label: "Abandoned cart" },
      { id: "shopify_customer", label: "Shopify customer" },
      { id: "csv_import",       label: "CSV import" },
      { id: "push_only",        label: "Push only" },
      { id: "journey_enrollment", label: "Flow enrollment" },
      { id: "manual",           label: "Added manually" },
    ] },
  { id: "hasTag",         label: "Has tag",     group: "Profile", type: "tag",     supported: true },
  { id: "firstSeenAt",    label: "First seen",  group: "Profile", type: "date",    supported: true },
  { id: "lastSeenAt",     label: "Last seen",   group: "Profile", type: "date",    supported: true },
  // Backed by Contact.pushEnabled, recomputed whenever a browser subscription
  // is created, removed, or reported gone by the push provider.
  { id: "pushEnabled",    label: "Push enabled", group: "Profile", type: "boolean", supported: true },
];

export const FIELD_BY_ID = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

/**
 * Field groups that only ever hold data on a workspace with a connected store.
 * Purchase and Cart columns are written by order ingestion and checkout
 * webhooks; without a storefront they are permanently zero, and a rule built on
 * one silently matches nobody.
 */
const COMMERCE_GROUPS = new Set(["Purchase", "Cart"]);

/**
 * The fields a workspace can actually build rules on.
 *
 * FIELD_BY_ID stays complete on purpose — an existing segment written before a
 * store was disconnected must still render its own rule labels.
 *
 * @param {boolean} isShopify
 */
export function fieldsFor(isShopify) {
  return isShopify ? FIELDS : FIELDS.filter((f) => !COMMERCE_GROUPS.has(f.group));
}

/**
 * The fields a flow entry filter can use — supported ones only.
 *
 * Nothing is gated today, so this currently returns the same list as
 * fieldsFor(). The filter stays because the asymmetry it encodes is permanent.
 *
 * Segments show a gated field with a "Soon" pill, and the evaluator treats it
 * as a no-op that matches everyone. That is defensible there: the count is a
 * little wrong and visibly marked as such.
 *
 * It is not defensible here. A flow filter decides who gets mail, so a rule
 * that silently matches everyone does the opposite of what the merchant asked
 * — "only customers with an open rate above 20%" would send to the whole list.
 * Better to not offer a field than to offer one that quietly inverts itself.
 *
 * @param {boolean} isShopify
 */
export function flowFilterFieldsFor(isShopify) {
  return fieldsFor(isShopify).filter((f) => f.supported);
}

// ── A note on splits ───────────────────────────────────────────────────────
// A split's field list is this catalog PLUS flow-scoped fields ("opened the
// welcome email", "clicked step 2").
//
// Those cannot live in FIELDS. Everything here is per-contact and lifetime,
// while a split asks about one particular step of one particular run of one
// particular flow — a question this vocabulary cannot express. They are
// generated per split, from the steps actually above it, by
// flowFieldsForSplit() in lib/journey/split-conditions.server.js and evaluated
// there too.
//
// They must NOT be routed through evalTreeForContact: it treats an
// unrecognised field as a no-op returning true, which for a split would send
// the entire audience down the Yes branch. Same trap as the paragraph above,
// with a bigger blast radius.

/** Segment starter templates a workspace can actually use. */
export function templatesFor(isShopify) {
  if (isShopify) return TEMPLATES;
  const allowed = new Set(fieldsFor(false).map((f) => f.id));
  const usesOnly = (node) => {
    if (!node) return true;
    if (node.type === "group") return (node.children || []).every(usesOnly);
    return allowed.has(node.field);
  };
  return TEMPLATES.filter((t) => usesOnly(t.rules));
}

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
    id: "tpl_lapsed",
    name: "Lapsed subscribers",
    description: "Sent email, but nothing opened in 90 days",
    icon: "Clock",
    accent: "#E5DCCF",
    accentInk: "#5A4A33",
    // The standard re-engagement and list-hygiene segment. The emailsSent rule
    // is what keeps it honest: "last email opened" is deliberately true for
    // someone who has never opened, and without this it would also collect
    // every contact who has never been sent anything at all.
    rules: { type: "group", match: "all", children: [
      { type: "rule", field: "emailsSent", op: "gt", value: 0 },
      { type: "rule", field: "lastEmailOpenedAt", op: "more_than", value: 90, unit: "days" },
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
