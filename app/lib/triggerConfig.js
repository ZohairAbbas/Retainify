// Shared trigger display config — used by flows list, builder, and automations

export const TRIGGER_CONFIG = {
  customer_created: {
    label: "Subscribed to Marketing",
    tint: "trigger",
    icon: "Users",
    desc: "Starts when a new contact opts in.",
  },
  cart_abandoned: {
    label: "Cart Abandoned",
    tint: "sms",
    icon: "Cart",
    desc: "Starts when a cart sits idle for 60 minutes.",
  },
  order_placed: {
    label: "Order Placed",
    tint: "email",
    icon: "Heart",
    desc: "Starts when a customer completes checkout.",
  },
  win_back: {
    label: "Inactive 90 days",
    tint: "delay",
    icon: "Refresh",
    desc: "Starts when a customer has not purchased in 90 days.",
  },
  segment_entered: {
    label: "Entered a Segment",
    tint: "trigger",
    icon: "Sliders",
    desc: "Starts when a contact newly matches a segment.",
  },
};

export const STATUS_PILL = {
  draft: "draft",
  published: "active",
  paused: "paused",
  archived: "archived",
};

export function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
  return new Date(date).toLocaleDateString();
}
