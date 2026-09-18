/**
 * Flow template library — every pre-built flow, for every kind of workspace.
 *
 * Framework-free (no prisma, no React): the Create Flow modal reads the same
 * list the server builds flows from, so what a card shows is what you get.
 *
 * ── What a template declares ─────────────────────────────────────────────
 *   trigger            what starts it. Commerce triggers (cart_abandoned,
 *                      order_placed, win_back, customer_created) need a
 *                      Shopify store; segment_entered works anywhere;
 *                      api_event is Growzar Internal's app lifecycle.
 *   triggerSegmentKey  for segment_entered: a built-in segment (sys_*), or
 *                      null when the merchant should pick one (the builder
 *                      asks, and publish refuses without it).
 *   triggerApp/Event   for api_event.
 *   requires           what must exist for it to be offered at all
 *                      ("shopify", "internal", "direct") or to send
 *                      ("whatsapp", "push"). WhatsApp templates are offered
 *                      before WhatsApp is connected — the builder then shows
 *                      exactly what to set up — but are only RECOMMENDED once
 *                      it is.
 *   priority           how strongly to recommend it when nothing like it is
 *                      running yet; higher first.
 *
 * Steps: email | delay | whatsapp | push | exit. A WhatsApp step starts with
 * no template chosen — only the merchant's own Meta-approved templates can be
 * sent, so the builder asks them to pick one.
 */

export const TEMPLATE_CATEGORIES = [
  { id: "welcome", label: "Welcome" },
  { id: "cart", label: "Cart recovery" },
  { id: "post_purchase", label: "Post-purchase" },
  { id: "winback", label: "Win-back" },
  { id: "engagement", label: "Engagement" },
  { id: "lifecycle", label: "App lifecycle" },
];

const email = (emailName, subject, previewText = "", extra = {}) => ({
  nodeType: "email", emailName, subject, previewText, templateStyle: "classic", discountPct: 0, isEnabled: true, ...extra,
});
const wait = (hours) => ({ nodeType: "delay", delayHours: hours });
const whatsapp = (label) => ({ nodeType: "whatsapp", emailName: label, isEnabled: true });
const push = (title, body) => ({ nodeType: "push", pushTitle: title, pushBody: body, isEnabled: true });
const exit = { nodeType: "exit" };

export const FLOW_TEMPLATES = [
  // ── Welcome ─────────────────────────────────────────────────────────────
  {
    key: "welcome_series",
    name: "Welcome Series",
    description: "Turn new subscribers into first-time customers with a proven three-email series.",
    trigger: "customer_created",
    category: "welcome",
    requires: ["shopify"],
    priority: 90,
    bestFor: ["Introducing new subscribers to your brand", "Converting subscribers to first-time customers", "Establishing regular email touchpoints"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["order_placed", "unsubscribed"],
      steps: [
        email("Welcome", "Welcome to {store}!", "We're glad you're here."),
        wait(48),
        email("What makes us different", "Here's what makes us different"),
        wait(72),
        email("First order discount", "Your first order — 10% off", "A welcome gift from us.", { templateStyle: "bold", discountPct: 10 }),
        exit,
      ],
    },
  },
  {
    key: "welcome_whatsapp",
    name: "Welcome on Email + WhatsApp",
    description: "Say hello by email, then follow up on WhatsApp where new customers actually read.",
    trigger: "customer_created",
    category: "welcome",
    requires: ["shopify", "whatsapp"],
    priority: 92,
    bestFor: ["Stores whose customers live on WhatsApp", "Higher first-order conversion than email alone", "Markets where email open rates are low"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["order_placed", "unsubscribed"],
      steps: [
        email("Welcome", "Welcome to {store}!", "We're glad you're here."),
        wait(24),
        whatsapp("WhatsApp welcome"),
        wait(72),
        email("First order discount", "Your first order — 10% off", "A welcome gift from us.", { templateStyle: "bold", discountPct: 10 }),
        exit,
      ],
    },
  },
  {
    key: "welcome_new_contacts",
    name: "Welcome New Contacts",
    description: "Greet everyone who joins your list and set expectations for what you'll send.",
    trigger: "segment_entered",
    triggerSegmentKey: "sys_new",
    category: "welcome",
    requires: ["direct"],
    priority: 90,
    bestFor: ["Lists built from imports and sign-up forms", "Making a first impression in the first week", "Reducing early unsubscribes"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["unsubscribed"],
      steps: [
        email("Welcome", "Welcome — here's what to expect", "Glad to have you."),
        wait(72),
        email("Get the most out of us", "Three things worth knowing"),
        exit,
      ],
    },
  },
  {
    key: "nurture_education",
    name: "Nurture & Educate",
    description: "A four-part series that teaches new contacts how to get value, one idea at a time.",
    trigger: "segment_entered",
    triggerSegmentKey: "sys_new",
    category: "engagement",
    requires: [],
    priority: 55,
    bestFor: ["Products that need explaining", "Building trust before asking for a sale", "B2B and considered purchases"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["unsubscribed"],
      steps: [
        email("Lesson 1", "The one thing most people get wrong"),
        wait(72),
        email("Lesson 2", "A quick win you can try today"),
        wait(96),
        email("Lesson 3", "How others use it"),
        wait(96),
        email("Next step", "Ready for the next step?", "", { templateStyle: "bold" }),
        exit,
      ],
    },
  },

  // ── Cart recovery ──────────────────────────────────────────────────────
  {
    key: "abandoned_cart",
    name: "Abandoned Cart",
    description: "Recover lost sales with three well-timed emails when a customer abandons checkout.",
    trigger: "cart_abandoned",
    category: "cart",
    requires: ["shopify"],
    priority: 100,
    bestFor: ["Recovering abandoned checkouts", "Reminding shoppers what they left behind", "Closing sales with a time-limited discount"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["order_placed", "cart_recovered", "unsubscribed"],
      steps: [
        // The first nudge waits an hour: sooner and it lands while the
        // customer is still typing their address.
        wait(1),
        email("Reminder", "You left something behind", "Pick up where you left off."),
        wait(23),
        email("Follow-up", "Still thinking it over?"),
        wait(48),
        email("Last chance", "Last chance — 10% off", "Your code expires soon.", { templateStyle: "bold", discountPct: 10 }),
        exit,
      ],
    },
  },
  {
    key: "abandoned_cart_whatsapp",
    name: "Abandoned Cart on WhatsApp",
    description: "A WhatsApp reminder first — often read within minutes — then email follow-ups.",
    trigger: "cart_abandoned",
    category: "cart",
    requires: ["shopify", "whatsapp"],
    priority: 105,
    bestFor: ["COD and mobile-first markets", "Carts too valuable to leave to email alone", "Shoppers who never open marketing email"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["order_placed", "cart_recovered", "unsubscribed"],
      steps: [
        wait(1),
        whatsapp("WhatsApp cart reminder"),
        wait(23),
        email("Reminder", "You left something behind", "Your cart is saved."),
        wait(48),
        email("Last chance", "Last chance — 10% off", "Your code expires soon.", { templateStyle: "bold", discountPct: 10 }),
        exit,
      ],
    },
  },
  {
    key: "abandoned_cart_push",
    name: "Abandoned Cart with Push",
    description: "A browser push within the hour, then email — reaches shoppers who didn't finish on the same device.",
    trigger: "cart_abandoned",
    category: "cart",
    requires: ["shopify", "push"],
    priority: 70,
    bestFor: ["Stores with push subscribers", "Fast, low-cost first touch", "Adding a channel without touching your emails"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["order_placed", "cart_recovered", "unsubscribed"],
      steps: [
        wait(1),
        push("You left something in your cart", "Tap to pick up where you left off."),
        wait(3),
        email("Reminder", "You left something behind", "Pick up where you left off."),
        wait(44),
        email("Last chance", "Last chance — 10% off", "Your code expires soon.", { templateStyle: "bold", discountPct: 10 }),
        exit,
      ],
    },
  },

  // ── Post-purchase ──────────────────────────────────────────────────────
  {
    key: "post_purchase",
    name: "Post-Purchase",
    description: "Build loyalty after an order with thank-you, review and replenishment emails.",
    trigger: "order_placed",
    category: "post_purchase",
    requires: ["shopify"],
    priority: 80,
    bestFor: ["Thanking customers after an order", "Collecting reviews and feedback", "Driving repeat purchases on consumables"],
    definition: {
      entryFrequency: "immediate",
      exitCriteria: ["unsubscribed"],
      steps: [
        email("Thank you", "Thank you for your order!"),
        wait(70),
        email("Review request", "How's your order? Leave a review", "", { templateStyle: "minimal" }),
        wait(264),
        email("Replenish", "Time to restock?", "Save 15% on your next order.", { templateStyle: "bold", discountPct: 15 }),
        exit,
      ],
    },
  },
  {
    key: "order_thanks_whatsapp",
    name: "Order Thank-You on WhatsApp",
    description: "Thank buyers on WhatsApp right after they order, then ask for a review by email.",
    trigger: "order_placed",
    category: "post_purchase",
    requires: ["shopify", "whatsapp"],
    priority: 82,
    bestFor: ["COD stores confirming intent early", "A personal touch after checkout", "Fewer refused deliveries"],
    definition: {
      entryFrequency: "immediate",
      exitCriteria: ["unsubscribed"],
      steps: [
        whatsapp("WhatsApp thank-you"),
        wait(120),
        email("Review request", "How's your order? Leave a review", "", { templateStyle: "minimal" }),
        exit,
      ],
    },
  },
  {
    key: "review_request",
    name: "Review Request",
    description: "Ask for a review once the order has had time to arrive, with one gentle reminder.",
    trigger: "order_placed",
    category: "post_purchase",
    requires: ["shopify"],
    priority: 60,
    bestFor: ["Building social proof", "Catching problems before they become refunds", "Stores with long delivery times"],
    definition: {
      entryFrequency: "immediate",
      exitCriteria: ["unsubscribed"],
      steps: [
        wait(168),
        email("Review request", "How did we do?", "It takes 30 seconds.", { templateStyle: "minimal" }),
        wait(120),
        email("Review reminder", "One quick favour?", "", { templateStyle: "minimal" }),
        exit,
      ],
    },
  },
  {
    key: "cross_sell",
    name: "Cross-Sell",
    description: "Two weeks after an order, suggest what goes well with what they bought.",
    trigger: "order_placed",
    category: "post_purchase",
    requires: ["shopify"],
    priority: 50,
    bestFor: ["Catalogues with complementary products", "Raising lifetime value", "A second order before the first is forgotten"],
    definition: {
      entryFrequency: "immediate",
      exitCriteria: ["unsubscribed"],
      steps: [
        wait(336),
        email("Pairs well with", "Customers who bought this also love…"),
        wait(120),
        email("Offer", "10% off your next order", "", { templateStyle: "bold", discountPct: 10 }),
        exit,
      ],
    },
  },

  // ── Win-back ───────────────────────────────────────────────────────────
  {
    key: "winback",
    name: "Customer Win-back",
    description: "Bring back customers who haven't ordered in a while, ending with an offer.",
    trigger: "win_back",
    category: "winback",
    requires: ["shopify"],
    priority: 70,
    bestFor: ["Re-engaging dormant customers", "Driving repeat purchase", "Cleaning your list of disengaged contacts"],
    definition: {
      entryFrequency: "delayed_2160",
      exitCriteria: ["order_placed", "unsubscribed"],
      steps: [
        email("We miss you", "We miss you!", "It's been a while."),
        wait(72),
        email("Reminder", "Still thinking about us?"),
        wait(96),
        email("Offer", "Come back — 15% off, just for you", "A welcome-back gift.", { templateStyle: "bold", discountPct: 15 }),
        exit,
      ],
    },
  },
  {
    key: "reengage_at_risk",
    name: "Re-engage At-Risk Contacts",
    description: "Reach people going quiet — no activity for a month — before they're gone for good.",
    trigger: "segment_entered",
    triggerSegmentKey: "sys_atrisk",
    category: "winback",
    requires: [],
    priority: 65,
    bestFor: ["Keeping your list warm", "Catching churn early", "Protecting sender reputation"],
    definition: {
      entryFrequency: "delayed_2160",
      exitCriteria: ["unsubscribed"],
      steps: [
        email("Checking in", "Still interested?", "We'd love to stay in touch."),
        wait(120),
        email("What's new", "Here's what you've missed"),
        exit,
      ],
    },
  },
  {
    key: "reengage_whatsapp",
    name: "Re-engage on WhatsApp",
    description: "People who stopped opening email often still read WhatsApp. Try there, then email once more.",
    trigger: "segment_entered",
    triggerSegmentKey: "sys_atrisk",
    category: "winback",
    requires: ["whatsapp"],
    priority: 68,
    bestFor: ["Contacts who ignore email", "Mobile-first audiences", "A last try before they churn"],
    definition: {
      entryFrequency: "delayed_2160",
      exitCriteria: ["unsubscribed"],
      steps: [
        whatsapp("WhatsApp check-in"),
        wait(96),
        email("What's new", "Here's what you've missed"),
        exit,
      ],
    },
  },
  {
    key: "sunset_churned",
    name: "Last Call for Churned Contacts",
    description: "One offer, then one goodbye — and stop mailing people who clearly aren't reading.",
    trigger: "segment_entered",
    triggerSegmentKey: "sys_churned",
    category: "winback",
    requires: [],
    priority: 40,
    bestFor: ["List hygiene", "Improving deliverability", "A final win-back attempt"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["unsubscribed"],
      steps: [
        email("Offer", "Before you go — something for you", "", { templateStyle: "bold", discountPct: 15 }),
        wait(168),
        email("Goodbye", "Should we stop emailing you?", "One click to stay on the list.", { templateStyle: "minimal" }),
        exit,
      ],
    },
  },

  // ── Growzar app lifecycle (internal workspace only) ─────────────────────
  {
    key: "app_onboarding",
    name: "App Onboarding",
    description: "Welcome a merchant who just installed, then guide them to finish setup. Ends when setup is done.",
    trigger: "api_event", triggerApp: "courierify", triggerEvent: "installed",
    category: "lifecycle",
    requires: ["internal"],
    priority: 100,
    bestFor: ["Every new install", "Getting merchants to their first success", "Fewer setup support tickets"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["setup_completed", "uninstalled"],
      steps: [
        email("Welcome", "Welcome to {data.app|our app}, {data.owner_name|there}!", "Here's how to get set up."),
        wait(24),
        email("Finish setup", "One step left: connect your courier"),
        wait(72),
        email("Need a hand?", "Want us to set it up with you?", "Book a free 15-minute call.", { templateStyle: "minimal" }),
        exit,
      ],
    },
  },
  {
    key: "app_setup_nudge",
    name: "Setup Nudge (Email + WhatsApp)",
    description: "When setup is still incomplete a day after install, nudge by email and then WhatsApp.",
    trigger: "api_event", triggerApp: "courierify", triggerEvent: "setup_incomplete",
    category: "lifecycle",
    requires: ["internal", "whatsapp"],
    priority: 85,
    bestFor: ["Merchants stuck on setup", "Reaching owners who ignore email", "Turning installs into active users"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["setup_completed", "uninstalled"],
      steps: [
        email("Setup reminder", "You're one step away", "Connect your courier to start booking."),
        wait(48),
        whatsapp("WhatsApp setup nudge"),
        exit,
      ],
    },
  },
  {
    key: "app_never_activated",
    name: "Never Activated",
    description: "A week after install with no bookings: offer help and a call before they give up.",
    trigger: "api_event", triggerApp: "courierify", triggerEvent: "never_activated",
    category: "lifecycle",
    requires: ["internal"],
    priority: 80,
    bestFor: ["Installs that never got going", "Rescuing trials", "Finding out what's blocking people"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["first_booking", "uninstalled"],
      steps: [
        email("Can we help?", "Stuck getting started?", "Reply and we'll help personally."),
        wait(72),
        email("Book a call", "Let's get your first shipment booked together", "", { templateStyle: "minimal" }),
        exit,
      ],
    },
  },
  {
    key: "app_usage_upgrade",
    name: "Usage Upgrade Nudge",
    description: "At 80% of the monthly allowance, show what the next plan unlocks before they hit the limit.",
    trigger: "api_event", triggerApp: "courierify", triggerEvent: "usage_80",
    category: "lifecycle",
    requires: ["internal"],
    priority: 90,
    bestFor: ["Growing merchants", "Upgrades at the moment of need", "Avoiding surprise limit blocks"],
    definition: {
      entryFrequency: "immediate",
      exitCriteria: ["plan_upgraded", "uninstalled"],
      steps: [
        email("Approaching limit", "You've used {data.usage_pct|80}% of this month's bookings", "Resets on {data.resets_on|the 1st}."),
        wait(72),
        email("Upgrade", "Keep shipping without limits", "", { templateStyle: "bold" }),
        exit,
      ],
    },
  },
  {
    key: "app_limit_reached",
    name: "Limit Reached (Email + WhatsApp)",
    description: "When a merchant hits their limit, tell them straight away on both channels.",
    trigger: "api_event", triggerApp: "courierify", triggerEvent: "usage_limit_reached",
    category: "lifecycle",
    requires: ["internal", "whatsapp"],
    priority: 88,
    bestFor: ["Preventing blocked bookings", "Timely upgrade offers", "Owners who need to know now"],
    definition: {
      entryFrequency: "immediate",
      exitCriteria: ["plan_upgraded", "uninstalled"],
      steps: [
        email("Limit reached", "You've reached this month's booking limit", "Upgrade to keep booking."),
        wait(2),
        whatsapp("WhatsApp limit alert"),
        exit,
      ],
    },
  },
  {
    key: "app_inactive_winback",
    name: "Inactive Merchant Win-back",
    description: "A merchant stopped booking for two weeks: check in, then show what's new.",
    trigger: "api_event", triggerApp: "courierify", triggerEvent: "inactive",
    category: "lifecycle",
    requires: ["internal"],
    priority: 75,
    bestFor: ["Catching churn before uninstall", "Surfacing problems early", "Re-activating seasonal stores"],
    definition: {
      entryFrequency: "delayed_720",
      exitCriteria: ["reactivated", "uninstalled"],
      steps: [
        email("Checking in", "Everything OK with your shipments?", "We noticed things went quiet."),
        wait(120),
        email("What's new", "New since you last booked"),
        exit,
      ],
    },
  },
  {
    key: "app_uninstall_feedback",
    name: "Uninstall Feedback & Win-back",
    description: "Ask why they left, then — a week later — invite them back with what's changed.",
    trigger: "api_event", triggerApp: "courierify", triggerEvent: "uninstalled",
    category: "lifecycle",
    requires: ["internal"],
    priority: 70,
    bestFor: ["Learning why merchants leave", "Winning back fixable churn", "Closing the loop politely"],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["reinstalled"],
      steps: [
        wait(24),
        email("Feedback", "Sorry to see you go — what could we do better?", "", { templateStyle: "minimal" }),
        wait(168),
        email("Come back", "We've made some changes", "", { templateStyle: "bold" }),
        exit,
      ],
    },
  },
];

/** The channels a template sends on, from its steps. */
export function templateChannels(t) {
  const kinds = new Set((t.definition?.steps || []).map((s) => s.nodeType));
  return ["email", "whatsapp", "push"].filter((c) => kinds.has(c));
}

/**
 * Whether a template can be offered in this workspace at all. Channel
 * readiness is not checked here: a WhatsApp template is offered before
 * WhatsApp is connected, and the builder shows how to finish setup.
 */
export function templateAvailable(t, { isShopify, isInternal }) {
  const r = t.requires || [];
  if (r.includes("shopify") && !isShopify) return false;
  if (r.includes("push") && !isShopify) return false;
  if (r.includes("internal") && !isInternal) return false;
  if (r.includes("direct") && (isShopify || isInternal)) return false;
  return true;
}

/**
 * Recommend the best next flows for this workspace, with the reason.
 *
 * A template is a candidate when nothing like it is running yet — no live or
 * draft flow on the same trigger (and, for app events, the same event) — and
 * it can actually send: WhatsApp templates only once WhatsApp is ready, push
 * only with push subscribers. Of two candidates covering the same trigger the
 * higher priority wins, so a store with WhatsApp gets "Abandoned Cart on
 * WhatsApp" rather than both cart flows. Returns up to `limit` keys.
 *
 * @param {Array} templates available templates
 * @param {{ existing: Array<{trigger: string, triggerApp?: string|null, triggerEvent?: string|null, triggerSegmentKey?: string|null}>,
 *           whatsappReady: boolean, pushSubscribers: number, orders: number,
 *           carts: number, contacts: number }} ctx
 */
export function recommendTemplates(templates, ctx, limit = 3) {
  // What a flow listens to. Two segment flows on different segments (at-risk
  // vs churned) are different jobs, as are the same event from two apps, so
  // the key carries the segment or app+event, not just the trigger type.
  const coverKey = (j) => {
    if (j.trigger === "api_event") return `api_event|${j.triggerApp || ""}|${j.triggerEvent || ""}`;
    if (j.trigger === "segment_entered") return `segment_entered|${j.triggerSegmentKey || ""}`;
    return j.trigger;
  };
  const covered = new Set(ctx.existing.map(coverKey));
  const reasonFor = (t) => {
    const r = t.requires || [];
    if (r.includes("whatsapp")) return "WhatsApp is connected — reach people where they read";
    if (t.trigger === "cart_abandoned") return ctx.carts ? `${ctx.carts.toLocaleString()} abandoned carts recently, and no recovery flow yet` : "No cart recovery flow running yet";
    if (t.trigger === "order_placed") return ctx.orders ? `${ctx.orders.toLocaleString()} orders to follow up on` : "Nothing runs after an order yet";
    if (t.trigger === "customer_created" || t.key === "welcome_new_contacts") return "New subscribers aren't welcomed yet";
    if (t.category === "lifecycle") return "No flow listens for this app event yet";
    if (t.category === "winback") return ctx.contacts ? "Catch contacts going quiet before they churn" : "Ready for when your list grows";
    return "Fills a gap in what you're running";
  };

  const byCover = new Map();
  for (const t of templates) {
    const r = t.requires || [];
    if (covered.has(coverKey(t))) continue;
    if (r.includes("whatsapp") && !ctx.whatsappReady) continue;
    if (r.includes("push") && !ctx.pushSubscribers) continue;
    const prev = byCover.get(coverKey(t));
    if (!prev || (t.priority || 0) > (prev.priority || 0)) byCover.set(coverKey(t), t);
  }
  return [...byCover.values()]
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .slice(0, limit)
    .map((t) => ({ key: t.key, reason: reasonFor(t) }));
}
