// Client-safe constants for Contacts UI. Ported from
// `Contacts Flow/contactsdata.jsx`. Used by list + profile.

export const TAG_PALETTE = {
  forest: { bg: "#DCE7DF", ink: "#1F3D2F" },
  blue:   { bg: "#DCE4ED", ink: "#25406A" },
  amber:  { bg: "#F1E4C5", ink: "#6B5018" },
  purple: { bg: "#EAD6EA", ink: "#5A2E5A" },
  tan:    { bg: "#E4DAD7", ink: "#5A3F38" },
  red:    { bg: "#EED9D2", ink: "#7A2E1F" },
};

export const LIFECYCLE = {
  new: {
    id: "new",
    label: "New",
    bg: "var(--info-bg)",
    ink: "var(--info-ink)",
    rule: "First seen ≤ 14 days ago, no orders yet.",
  },
  never_purchased: {
    id: "never_purchased",
    label: "Never purchased",
    bg: "#E4DAD7",
    ink: "#5A3F38",
    rule: "Around 14+ days, hasn't placed an order.",
  },
  active: {
    id: "active",
    label: "Active",
    bg: "var(--brand-100)",
    ink: "var(--brand-700)",
    rule: "Ordered in the last 30 days.",
  },
  at_risk: {
    id: "at_risk",
    label: "At-risk",
    bg: "var(--warn-bg)",
    ink: "var(--warn-ink)",
    rule: "Last order 31–90 days ago.",
  },
  churned: {
    id: "churned",
    label: "Churned",
    bg: "var(--status-draft-bg)",
    ink: "var(--status-draft-ink)",
    rule: "Last order more than 90 days ago.",
  },
};

export const LIFECYCLE_ORDER = ["new", "never_purchased", "active", "at_risk", "churned"];

export const STATUS = {
  subscribed:     { label: "Subscribed",     bg: "var(--success-bg)",      ink: "var(--success-ink)" },
  unsubscribed:   { label: "Unsubscribed",   bg: "var(--status-draft-bg)", ink: "var(--status-draft-ink)" },
  bounced:        { label: "Bounced",        bg: "var(--danger-bg)",       ink: "var(--danger-ink)" },
  complained:     { label: "Complained",     bg: "var(--danger-bg)",       ink: "var(--danger-ink)" },
  never_opted_in: { label: "Never opted in", bg: "#E7E4D8",                ink: "#4A4736" },
};

export const SOURCE = {
  popup:            "Popup",
  cart_abandoned:   "Abandoned cart",
  shopify_customer: "Shopify customer",
  csv_import:       "CSV import",
  push_only:        "Push only",
  manual:           "Added manually",
};

export const EVENT_VISUALS = {
  signed_up:        { icon: "Mail",    tint: "trigger" },
  confirmed_email:  { icon: "Check",   tint: "trigger" },
  cart_abandoned:   { icon: "Cart",    tint: "sms" },
  cart_recovered:   { icon: "Check",   tint: "email" },
  order_placed:     { icon: "Heart",   tint: "email" },
  email_sent:       { icon: "Send",    tint: "delay" },
  email_opened:     { icon: "Eye",     tint: "email" },
  email_clicked:    { icon: "Bolt",    tint: "email" },
  push_sent:        { icon: "Bell",    tint: "split" },
  push_clicked:     { icon: "Bolt",    tint: "split" },
  unsubscribed:     { icon: "Close",   tint: "exit" },
  bounced:          { icon: "Close",   tint: "exit" },
  complained:       { icon: "Close",   tint: "exit" },
  tagged:           { icon: "Tag",     tint: "tag" },
  untagged:         { icon: "Tag",     tint: "tag" },
  entered_journey:  { icon: "Flow",    tint: "trigger" },
  exited_journey:   { icon: "Exit",    tint: "exit" },
  added_to_segment: { icon: "Sliders", tint: "trigger" },
  synced_from_shopify: { icon: "Refresh", tint: "delay" },
};

export const EVENT_LABEL = {
  signed_up:        "Signed up",
  confirmed_email:  "Confirmed email",
  cart_abandoned:   "Cart abandoned",
  cart_recovered:   "Cart recovered",
  order_placed:     "Order placed",
  email_sent:       "Email sent",
  email_opened:     "Email opened",
  email_clicked:    "Email clicked",
  push_sent:        "Push sent",
  push_clicked:     "Push clicked",
  unsubscribed:     "Unsubscribed",
  bounced:          "Email bounced",
  complained:       "Marked as spam",
  tagged:           "Tagged",
  untagged:         "Tag removed",
  entered_journey:  "Entered journey",
  exited_journey:   "Exited journey",
  added_to_segment: "Added to segment",
  synced_from_shopify: "Synced from Shopify",
};

export function fmtMoney(n) {
  if (n == null) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return `$${num.toLocaleString(undefined, {
    minimumFractionDigits: num % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtPctC(n) {
  if (n == null) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(1)}%`;
}

export function initials(nameOrEmail) {
  if (!nameOrEmail) return "·";
  const t = String(nameOrEmail).trim();
  if (t.includes(" ")) {
    return t.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  return t[0].toUpperCase();
}

// Deterministic warm-tone avatar background per seed (email or name).
const AVATAR_HUES = ["#DCE7DF", "#F1E4C5", "#EAD6EA", "#E4DAD7", "#DCE4ED", "#EED9D2", "#E7E4D8"];
const AVATAR_INKS = ["#1F3D2F", "#6B5018", "#5A2E5A", "#5A3F38", "#25406A", "#7A2E1F", "#4A4736"];

export function avatarColors(seed) {
  const s = (seed || "").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const idx = h % AVATAR_HUES.length;
  return { bg: AVATAR_HUES[idx], ink: AVATAR_INKS[idx] };
}

export function relativeTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
  if (s < 2592000) return `${Math.floor(s / 604800)} weeks ago`;
  if (s < 31536000) return `${Math.floor(s / 2592000)} months ago`;
  return date.toLocaleDateString();
}
