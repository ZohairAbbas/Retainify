// Retainify — Email Template Library (send-safe)
//
// The predesigned email layouts surfaced in the editor's "Browse templates"
// gallery. Each template is pure data: a brand kit + an ordered block list that
// loads straight into the visual editor's `emailBlocks`/`emailBrand`.
//
// IMPORTANT — send-safe schema only. The server-side renderer
// (app/lib/email/visual-renderer.server.js) is the SOLE send path for journey
// emails and silently SKIPS any block type / brand value it doesn't understand.
// So every template here is restricted to what both the editor (BlockView in
// app/components/EmailEditor.jsx) AND the renderer support:
//
//   blocks      logo, heading, paragraph, button, image, spacer, divider,
//               product, discount, footer, quote, list, callout, social,
//               video, columns, coupon
//   fontPair    editorial | modern | classic | display | mono | hand |
//               brutal | moody  (editor + email <head> load the webfonts;
//               clients that drop them fall back to serif/sans/mono)
//   brand       logoText, accent, bg, ink, subInk, onAccent, fontPair
//               ink = headings/wordmark, subInk = body, onAccent = button text
//   discount    { percent, label } — NO hardcoded code (Shopify generates it
//               at send time and injects ctx.discount_code)
//   image       src "" placeholder — merchant uploads; no `tone`/`placeholder`
//   per-block   heading/paragraph accept an optional `color`; button accepts
//               `bgColor`/`textColor` — all fall back to the brand kit.
//
// The original prototype used eyebrow/signature/bignumber blocks; those are
// down-mapped to paragraph/heading (a renderer-supported type) but keep their
// authored brand colors + font pair, so the gallery preview is bit-for-bit
// what sends (in webfont-capable clients).

// ── Vibes (primary gallery filter — style, not journey) ──────────────────
export const VIBES = {
  editorial: { id: "editorial", name: "Editorial", oneliner: "Quiet serif, generous margins, single column. For curated, slow-paced brands." },
  modernist: { id: "modernist", name: "Modernist", oneliner: "Sans-serif, left-aligned, confident. For design tools and tech." },
  bold:      { id: "bold",      name: "Bold",      oneliner: "High contrast, urgent. For streetwear and high-energy DTC." },
  warm:      { id: "warm",      name: "Warm",      oneliner: "Soft palettes, playful copy. For beauty, food, lifestyle." },
  moody:     { id: "moody",     name: "Moody",     oneliner: "Dark grounds, serif accents. For luxury and perfumeries." },
};
export const VIBE_ORDER = ["editorial", "modernist", "bold", "warm", "moody"];

// ── Journeys (secondary metadata — a "Suited for…" chip on each card) ────
// `icon` must be a key in app/components/ui/Icons.jsx. `tint` reuses the
// rt-tint-* color classes already in the stylesheet.
export const JOURNEYS = {
  welcome:  { id: "welcome",  name: "Welcome Series", icon: "Users",    tint: "trigger", oneliner: "Turn new subscribers into first-time buyers." },
  cart:     { id: "cart",     name: "Abandoned Cart", icon: "Cart",     tint: "sms",     oneliner: "Recover lost sales with well-timed nudges." },
  post:     { id: "post",     name: "Post-Purchase",  icon: "Heart",    tint: "email",   oneliner: "Thank, delight, and drive a second order." },
  winback:  { id: "winback",  name: "Win-back",       icon: "Refresh",  tint: "delay",   oneliner: "Revive lapsed customers before they churn." },
  birthday: { id: "birthday", name: "Birthday",       icon: "Sparkles", tint: "split",   oneliner: "Celebrate customers with a yearly treat." },
  news:     { id: "news",     name: "Newsletter",     icon: "Mail",     tint: "email",   oneliner: "A regular letter your readers look forward to." },
  announce: { id: "announce", name: "Announcement",   icon: "Megaphone", tint: "trigger", oneliner: "A launch, an event, or news worth an email." },
  onboard:  { id: "onboard",  name: "Onboarding",     icon: "Check",    tint: "delay",   oneliner: "Get someone to their first win." },
};
export const JOURNEY_ORDER = ["welcome", "cart", "post", "winback", "birthday", "news", "announce", "onboard"];

// ── Block constructors (send-safe) ───────────────────────────────────────
let _bid = 0;
const id = () => `t_${++_bid}`;

const lo = (text, size = "medium", align = "center") => ({ id: id(), type: "logo", text, align, size });
const h  = (html, level = 2, align = "left") => ({ id: id(), type: "heading", html, level, align });
const pa = (html, align = "left") => ({ id: id(), type: "paragraph", html, align });
const btn = (text, fill = "filled", align = "center") => ({ id: id(), type: "button", text, url: "{store_url}", align, fill });
// Placeholder image — no src. The editor shows the upload placeholder; the
// renderer skips it until the merchant uploads, so it never breaks a send.
const im = (label, height = 220, align = "full") => ({ id: id(), type: "image", src: "", alt: "", label, align, height });
const sp = (height = 24) => ({ id: id(), type: "spacer", height });
const di = (style = "solid") => ({ id: id(), type: "divider", style });
const pr = (count = 3, showPrice = true) => ({ id: id(), type: "product", count, showPrice });
// Discount: percent + caption only. Code auto-generates at send.
const dc = (label, percent) => ({ id: id(), type: "discount", label, percent });
const ft = (storeName, address) => ({ id: id(), type: "footer", storeName, address, unsubscribe: true });

// ── Newer blocks ─────────────────────────────────────────────────────────
const q  = (text, author, stars = 5, align = "center") => ({ id: id(), type: "quote", text, author, stars, align });
const li = (items, style = "check") => ({ id: id(), type: "list", items, style });
const co = (html, label = "", align = "center") => ({ id: id(), type: "callout", html, label, align });
const so = (networks, label = "Follow along") => ({ id: id(), type: "social", label, align: "center", links: networks.map((n) => ({ network: n, url: "" })) });
// No src: same rule as im() — the merchant adds the thumbnail, and until then
// the renderer skips it rather than sending a broken image.
const vi = (caption) => ({ id: id(), type: "video", src: "", url: "", caption, alt: "" });
const col = (heading, html, linkText = "", imageSide = "left") => ({ id: id(), type: "columns", src: "", alt: "", heading, html, linkText, url: "{store_url}", imageSide });
const cp = (code, label, note) => ({ id: id(), type: "coupon", code, label, note });

// ── Down-mapped constructors (prototype block → supported block) ─────────
// eyebrow → small uppercase paragraph (styling is the renderer's fixed
// paragraph style; we keep the all-caps text so the intent survives).
const eb = (text, align = "center") => pa(`<strong>${text}</strong>`, align);
// signature → italic paragraph.
const sig = (text, align = "left") =>
  pa(`<em>${String(text).replace(/\n/g, "<br/>")}</em>`, align);
// bignumber → an H1 headline (the percentage). Any caption the prototype
// carried is dropped here — every template pairs the big number with a
// discount block whose label already states the offer, so it's not lost.
const bn = (value, unit = "", align = "center") => h(`${value}${unit ? ` ${unit}` : ""}`, 1, align);

// ════════════════════════════════════════════════════════════════════════
// TEMPLATES
//
// Several carry no product or discount block on purpose: those are the ones a
// workspace without a Shopify store can send (templatesFor() below).
// ════════════════════════════════════════════════════════════════════════
export const TEMPLATES = {
  // ── WELCOME ────────────────────────────────────────────────────────────
  "welcome-le-salon": {
    id: "welcome-le-salon", journey: "welcome", vibeGroup: "editorial",
    name: "Le Salon", vibe: "Editorial · Quiet",
    oneliner: "A magazine letter from a small studio. For curated, slow-fashion brands.",
    brandPersona: "Northhill & Co.", brandCategory: "Linen · Ceramics · Lifestyle",
    tags: ["Editorial", "Serif", "Single column"], discount: 15,
    subject: "Welcome to the studio",
    preview: "A short letter from the bench in upstate New York.",
    brand: { logoText: "NORTHHILL & CO.", accent: "#1F3D2F", bg: "#FAF6EC", ink: "#14201A", subInk: "#5C625A", onAccent: "#FAF6EC", fontPair: "editorial" },
    blocks: [
      sp(12), eb("A NEW LETTER · ISSUE NO. 14"), sp(8),
      lo("NORTHHILL & CO.", "medium", "center"), sp(20),
      im("Hero · studio bench", 260), sp(28),
      h("Welcome to the <em>studio.</em>", 1, "center"), sp(12),
      pa("I'm Anna. Northhill &amp; Co. is a small studio in a converted barn upstate, where four of us make linen, ceramics, and small leather goods one batch at a time.", "center"), sp(20),
      dc("A welcome gift", 15), sp(22),
      btn("See what we made this week", "filled", "center"), sp(40),
      di("solid"), sp(20),
      ft("Northhill & Co.", "142 Mercer St, New York, NY 10012"),
    ],
  },

  "welcome-opus": {
    id: "welcome-opus", journey: "welcome", vibeGroup: "modernist",
    name: "The Brief", vibe: "Modernist · Clean",
    oneliner: "Clean and confident, like product release notes. For design-tool and tech brands.",
    brandPersona: "OPUS", brandCategory: "Design tools · SaaS",
    tags: ["Minimal", "Left-aligned", "Sans"], discount: 0,
    subject: "OPUS / Welcome",
    preview: "A two-minute primer on what we make and why.",
    brand: { logoText: "OPUS", accent: "#FF4D2A", bg: "#FFFFFF", ink: "#0E0E0E", subInk: "#5A5A5A", onAccent: "#FFFFFF", fontPair: "mono" },
    blocks: [
      sp(16), eb("OPUS / V2.4 / NEW READER", "left"), sp(10),
      h("Hello.", 1, "left"), sp(6),
      pa("Welcome aboard. You just joined ~12,400 designers who read this letter the second it ships.", "left"), sp(18),
      di("solid"), sp(18),
      eb("§ 01 — WHAT THIS IS", "left"), sp(6),
      pa("A weekly note on the tools we make at Opus — and the small craft decisions behind them.", "left"), sp(12),
      eb("§ 02 — WHAT TO EXPECT", "left"), sp(6),
      pa("Eight letters a year. Never a sale email. Sometimes a quiet beta invite.", "left"), sp(24),
      btn("Start a project", "filled", "left"), sp(36),
      di("solid"), sp(16),
      ft("Opus Design Co.", "88 Bridge St, Brooklyn, NY 11201"),
    ],
  },

  "welcome-olive-honey": {
    id: "welcome-olive-honey", journey: "welcome", vibeGroup: "warm",
    name: "Hi, Gorgeous", vibe: "Warm · Soft",
    oneliner: "An open-arms welcome with a small gift. Made for beauty, food, and lifestyle.",
    brandPersona: "Olive & Honey", brandCategory: "Skincare · Wellness",
    tags: ["Display serif", "Warm palette", "Gift"], discount: 10,
    subject: "Hi gorgeous — a tiny welcome gift inside",
    preview: "10% off your first ritual, plus our most-loved finds.",
    brand: { logoText: "olive & honey", accent: "#C7522A", bg: "#F8E8D8", ink: "#4A2E1F", subInk: "#7A4E3A", onAccent: "#F8E8D8", fontPair: "display" },
    blocks: [
      sp(20), lo("olive & honey", "medium", "center"), sp(18),
      im("Hero · still life of bottles", 280), sp(24),
      h("<em>Hi, gorgeous.</em>", 1, "center"), sp(10),
      pa("So glad you're here. We make tiny-batch skincare from one apothecary kitchen in Topanga — and we'd love to welcome you in with something on us.", "center"), sp(20),
      dc("Your welcome treat", 10), sp(22),
      btn("Find your ritual", "filled", "center"), sp(32),
      eb("— A FEW FAVOURITES —"), sp(12),
      pr(3, true), sp(28),
      sig("with love,\nMira & the team", "center"), sp(32),
      ft("Olive & Honey", "PO Box 224, Topanga, CA 90290"),
    ],
  },

  // ── ABANDONED CART ──────────────────────────────────────────────────────
  "cart-last-look": {
    id: "cart-last-look", journey: "cart", vibeGroup: "bold",
    name: "Last Look", vibe: "Bold · Urgent",
    oneliner: "High-contrast typography hits like a poster. For streetwear and bold DTC.",
    brandPersona: "ATELIER 84", brandCategory: "Streetwear · Sneakers",
    tags: ["Bold display", "Cart recovery", "Urgent"], discount: 10,
    subject: "YOU LEFT SOMETHING — last look",
    preview: "Your size, your color, still in the bag — but not for long.",
    brand: { logoText: "ATELIER 84", accent: "#E5FF36", bg: "#0E0E0E", ink: "#F4EFE4", subInk: "#A8A8A0", onAccent: "#0E0E0E", fontPair: "brutal" },
    blocks: [
      sp(20), lo("ATELIER 84", "small", "left"), sp(20),
      eb("LAST LOOK / 23H 49M LEFT", "left"), sp(10),
      h("You left something.", 1, "left"), sp(14),
      pa("Your bag is still warm. Your size is still in stock. But this code only works for the next 24 hours.", "left"), sp(28),
      bn("10% OFF"), sp(8),
      dc("Your code", 10), sp(20),
      btn("Finish checking out", "filled", "center"), sp(28),
      eb("// STILL IN YOUR BAG"), sp(12),
      pr(3, true), sp(36),
      di("solid"), sp(16),
      ft("Atelier 84", "500 Geary, San Francisco, CA 94102"),
    ],
  },

  "cart-quiet-reminder": {
    id: "cart-quiet-reminder", journey: "cart", vibeGroup: "editorial",
    name: "Quiet Reminder", vibe: "Editorial · Gentle",
    oneliner: "A no-pressure nudge for considered brands where urgency feels off.",
    brandPersona: "Northhill & Co.", brandCategory: "Considered · Slow-fashion",
    tags: ["Gentle", "Serif", "Single product"], discount: 0,
    subject: "A small reminder",
    preview: "Your cart is still here when you're ready.",
    brand: { logoText: "NORTHHILL & CO.", accent: "#1F3D2F", bg: "#FDFBF5", ink: "#14201A", subInk: "#5C625A", onAccent: "#FAF6EC", fontPair: "editorial" },
    blocks: [
      sp(28), lo("NORTHHILL & CO.", "small", "center"), sp(28),
      h("A small reminder.", 1, "center"), sp(12),
      pa("Your cart is still here. No pressure — we just wanted to mention it, in case you got distracted by a phone call or a sunset.", "center"), sp(28),
      im("The item in your cart", 240), sp(24),
      btn("Return to your cart", "outline", "center"), sp(40),
      di("solid"), sp(20),
      pa("If you have any questions — about sizing, finishes, anything at all — just reply to this letter and a real human will write back.", "center"), sp(20),
      ft("Northhill & Co.", "142 Mercer St, New York, NY 10012"),
    ],
  },

  // ── POST-PURCHASE ────────────────────────────────────────────────────────
  "post-thank-you-card": {
    id: "post-thank-you-card", journey: "post", vibeGroup: "warm",
    name: "Thank-You Card", vibe: "Warm · Personal",
    oneliner: "Reads like a card tucked into the box. Builds quiet loyalty.",
    brandPersona: "Olive & Honey", brandCategory: "Beauty · Small-batch",
    tags: ["Personal", "Order receipt", "Loyalty"], discount: 10,
    subject: "Thank you, gorgeous.",
    preview: "Your order is packed and on its way — plus a small thing to say thanks.",
    brand: { logoText: "olive & honey", accent: "#C7522A", bg: "#F4EFE4", ink: "#4A2E1F", subInk: "#7A4E3A", onAccent: "#F4EFE4", fontPair: "hand" },
    blocks: [
      sp(28), lo("olive & honey", "small", "center"), sp(28),
      h("Thank you.", 1, "center"), sp(14),
      pa("Your order is packed. I wrapped it myself this morning and it'll be on a truck before lunchtime.", "center"), sp(20),
      im("Polaroid · packed order", 220), sp(24),
      pa("Below is a small thing for next time. Tuck it away for when you run out.", "center"), sp(8),
      dc("A little thank-you", 10), sp(24),
      btn("Track your order", "filled", "center"), sp(28),
      sig("with love,\nMira", "center"), sp(32),
      ft("Olive & Honey", "PO Box 224, Topanga, CA 90290"),
    ],
  },

  "post-founder-note": {
    id: "post-founder-note", journey: "post", vibeGroup: "editorial",
    name: "Founder's Note", vibe: "Plain text · Letter",
    oneliner: "Looks like an email from the founder. Highest read rates, period.",
    brandPersona: "Northhill & Co.", brandCategory: "Considered DTC",
    tags: ["Plain text", "High open rate", "Founder voice"], discount: 0,
    subject: "a quick note from Anna",
    preview: "Thank you, and a real address if you want to write back.",
    brand: { logoText: "", accent: "#1F3D2F", bg: "#FFFFFF", ink: "#14201A", subInk: "#2D362F", onAccent: "#FFFFFF", fontPair: "modern" },
    blocks: [
      sp(36),
      pa("Hi {first_name},", "left"), sp(8),
      pa("Anna here, from Northhill. I wanted to say thanks for your order. It'll ship from the studio tomorrow morning, and you should have it by Friday.", "left"), sp(4),
      pa("If it doesn't show up by then — or if anything is bent, broken, or just not what you hoped for — write me back at this address. It's my actual email and I read every one.", "left"), sp(16),
      pa("Talk soon,", "left"),
      pa("Anna", "left"), sp(36),
      pa("PS — if you have a minute one day and want to send a photo of where it ended up, I would love that.", "left"), sp(40),
      ft("Northhill & Co.", "142 Mercer St, New York, NY 10012"),
    ],
  },

  // ── WIN-BACK ──────────────────────────────────────────────────────────────
  "winback-long-time": {
    id: "winback-long-time", journey: "winback", vibeGroup: "moody",
    name: "Long Time, No See", vibe: "Moody · Dark",
    oneliner: "Serif display on a deep ground. For perfumeries, jewelry, dark luxury.",
    brandPersona: "VELOUR", brandCategory: "Perfume · Luxury",
    tags: ["Dark", "Serif display", "Generous discount"], discount: 20,
    subject: "It's been a minute.",
    preview: "Come back, on us — 20% off, no expiry.",
    brand: { logoText: "VELOUR", accent: "#D4A35A", bg: "#1A1226", ink: "#FCE6D6", subInk: "#B79CB0", onAccent: "#1A1226", fontPair: "moody" },
    blocks: [
      sp(36), lo("VELOUR", "medium", "center"), sp(24),
      eb("— A LETTER TO ABSENT FRIENDS —"), sp(18),
      h("Long time, no see.", 1, "center"), sp(16),
      pa("It's been a minute since we last crossed paths. The shop has been quiet without you — we keep a list of names, and yours has been near the top of mine.", "center"), sp(20),
      im("Hero · velvet still life", 260), sp(28),
      dc("Come back, on us", 20), sp(28),
      btn("Take me back", "filled", "center"), sp(36),
      sig("— Léa", "center"), sp(28),
      ft("Velour Parfumerie", "8 rue Béranger, 75003 Paris"),
    ],
  },

  "winback-something-new": {
    id: "winback-something-new", journey: "winback", vibeGroup: "bold",
    name: "Something New", vibe: "Bright · Product-led",
    oneliner: "Show, don't tell. A product grid does the talking — for visual brands.",
    brandPersona: "ATELIER 84", brandCategory: "Streetwear · DTC",
    tags: ["Product-led", "Bold display", "Visual"], discount: 15,
    subject: "We've been busy.",
    preview: "See what dropped while you were gone.",
    brand: { logoText: "ATELIER 84", accent: "#0E0E0E", bg: "#FFFFFF", ink: "#0E0E0E", subInk: "#5A5A5A", onAccent: "#FFFFFF", fontPair: "brutal" },
    blocks: [
      sp(20), lo("ATELIER 84", "small", "left"), sp(20),
      eb("// 90 DAYS LATER", "left"), sp(8),
      h("We've been busy.", 1, "left"), sp(16),
      pa("14 drops, 2 collabs, and a whole new season of basics — while you were gone. Catch up:", "left"), sp(28),
      pr(4, true), sp(24),
      di("solid"), sp(20),
      bn("15% OFF"), sp(8),
      dc("Welcome-back gift", 15), sp(24),
      btn("See what dropped", "filled", "center"), sp(36),
      ft("Atelier 84", "500 Geary, San Francisco, CA 94102"),
    ],
  },

  // ── BIRTHDAY ──────────────────────────────────────────────────────────────
  "birthday-confetti": {
    id: "birthday-confetti", journey: "birthday", vibeGroup: "warm",
    name: "Confetti", vibe: "Playful · Bright",
    oneliner: "A birthday card that doesn't feel like a coupon. For any consumer brand.",
    brandPersona: "Olive & Honey", brandCategory: "Beauty · DTC",
    tags: ["Birthday", "Playful", "Annual"], discount: 25,
    subject: "🎉  it's your day, {first_name}",
    preview: "A 25% gift, because it's only fair.",
    brand: { logoText: "olive & honey", accent: "#E8568D", bg: "#FFF9F0", ink: "#2A1B4E", subInk: "#5A4E7A", onAccent: "#FFF9F0", fontPair: "display" },
    blocks: [
      sp(24), lo("olive & honey", "small", "center"), sp(20),
      eb("— FROM ALL OF US, ON YOUR DAY —"), sp(14),
      h("Happy birthday, <em>{first_name}.</em>", 1, "center"), sp(16),
      pa("We keep a calendar with the dates of our favourite people — and yours is today. We made you something.", "center"), sp(26),
      bn("25% OFF"), sp(8),
      dc("Your birthday treat", 25), sp(28),
      btn("Treat yourself", "filled", "center"), sp(36),
      sig("the whole team xx", "center"), sp(28),
      ft("Olive & Honey", "PO Box 224, Topanga, CA 90290"),
    ],
  },

  // ── WELCOME (no store needed) ───────────────────────────────────────────
  "welcome-what-to-expect": {
    id: "welcome-what-to-expect", journey: "welcome", vibeGroup: "modernist",
    name: "What to Expect", vibe: "Modernist · Plain",
    oneliner: "Sets expectations in the first email — the single best way to stay out of spam. Needs no store.",
    brandPersona: "OPUS", brandCategory: "Any business",
    tags: ["No discount", "Expectations", "Any website"], discount: 0,
    subject: "You're in — here's what happens next",
    preview: "What we send, how often, and how to leave whenever you like.",
    brand: { logoText: "OPUS", accent: "#1F3D2F", bg: "#FFFFFF", ink: "#0E0E0E", subInk: "#5A5A5A", onAccent: "#FFFFFF", fontPair: "modern" },
    blocks: [
      sp(24), lo("OPUS", "small", "left"), sp(16),
      h("You're in, {first_name}.", 1, "left"), sp(10),
      pa("Thanks for subscribing. So you know exactly what you signed up for:", "left"), sp(14),
      li("One email a week, on Thursday mornings\nPractical ideas you can use the same day\nFirst look at anything new we make\nOne click to unsubscribe, always", "check"), sp(22),
      btn("Start here", "filled", "left"), sp(28),
      so(["instagram", "linkedin", "website"], "Elsewhere"), sp(24),
      ft("Opus Design Co.", "88 Bridge St, Brooklyn, NY 11201"),
    ],
  },

  "welcome-first-steps": {
    id: "welcome-first-steps", journey: "onboard", vibeGroup: "modernist",
    name: "First Steps", vibe: "Onboarding · Numbered",
    oneliner: "Three numbered steps to a first win. For software, services and memberships.",
    brandPersona: "OPUS", brandCategory: "SaaS · Services",
    tags: ["Onboarding", "No discount", "Any website"], discount: 0,
    subject: "Your first three steps",
    preview: "Ten minutes today saves you an afternoon later.",
    brand: { logoText: "OPUS", accent: "#2A4A8C", bg: "#F7F8FA", ink: "#10131A", subInk: "#555C6A", onAccent: "#FFFFFF", fontPair: "modern" },
    blocks: [
      sp(24), lo("OPUS", "small", "left"), sp(16),
      h("Let's get you set up.", 2, "left"), sp(8),
      pa("Most people are up and running in under ten minutes. Here's the short version:", "left"), sp(14),
      li("Finish your profile so your work is saved\nInvite one teammate — it's better with two\nStart your first project from a template", "number"), sp(20),
      btn("Open your dashboard", "filled", "left"), sp(24),
      vi("Watch the 2-minute tour"), sp(24),
      pa("Stuck on any of it? Reply to this email — a real person reads every one.", "left"), sp(28),
      ft("Opus Design Co.", "88 Bridge St, Brooklyn, NY 11201"),
    ],
  },

  // ── CART ────────────────────────────────────────────────────────────────
  "cart-social-proof": {
    id: "cart-social-proof", journey: "cart", vibeGroup: "warm",
    name: "Others Loved It", vibe: "Warm · Social proof",
    oneliner: "Answers the real objection with a customer's own words, then shows the item again.",
    brandPersona: "Olive & Honey", brandCategory: "Beauty · Lifestyle",
    tags: ["Cart recovery", "Testimonial", "Product grid"], discount: 0,
    subject: "Still thinking it over?",
    preview: "What other people said after they took the plunge.",
    brand: { logoText: "olive & honey", accent: "#C7522A", bg: "#FFFBF6", ink: "#4A2E1F", subInk: "#7A4E3A", onAccent: "#FFFBF6", fontPair: "display" },
    blocks: [
      sp(24), lo("olive & honey", "small", "center"), sp(20),
      h("Still thinking it over?", 1, "center"), sp(10),
      pa("Completely fair. Here's what someone said after they stopped thinking about it:", "center"), sp(16),
      q("I put it off for a month and then used it every single day. Should have bought it sooner.", "Priya R., verified customer", 5), sp(20),
      pa("Your bag is still saved:", "center"), sp(8),
      pr(3, true), sp(20),
      btn("Return to your cart", "filled", "center"), sp(24),
      li("Free shipping over $50\n30-day returns, no questions\nReal humans answer every email", "check"), sp(28),
      ft("Olive & Honey", "PO Box 224, Topanga, CA 90290"),
    ],
  },

  "cart-free-shipping": {
    id: "cart-free-shipping", journey: "cart", vibeGroup: "modernist",
    name: "Shipping's On Us", vibe: "Modernist · One offer",
    oneliner: "One clear reason to come back now, with no discount to train people to wait for.",
    brandPersona: "ATELIER 84", brandCategory: "DTC · Any store",
    tags: ["Cart recovery", "No discount", "Callout"], discount: 0,
    subject: "Your cart — shipping's on us today",
    preview: "One less reason to wait.",
    brand: { logoText: "ATELIER 84", accent: "#1B2BFF", bg: "#FFFFFF", ink: "#0E0E0E", subInk: "#5A5A5A", onAccent: "#FFFFFF", fontPair: "modern" },
    blocks: [
      sp(24), lo("ATELIER 84", "small", "left"), sp(18),
      h("You left something behind.", 2, "left"), sp(10),
      pa("It's still in your bag, in your size. To make the decision easier:", "left"), sp(12),
      co("Free shipping on your order — today only", "One less reason to wait"), sp(18),
      pr(3, true), sp(18),
      btn("Finish checking out", "filled", "center"), sp(26),
      ft("Atelier 84", "500 Geary, San Francisco, CA 94102"),
    ],
  },

  // ── POST-PURCHASE ───────────────────────────────────────────────────────
  "post-how-to-use": {
    id: "post-how-to-use", journey: "post", vibeGroup: "editorial",
    name: "How To Use It", vibe: "Editorial · Helpful",
    oneliner: "Lands while they wait for delivery. Fewer returns, more second orders.",
    brandPersona: "Northhill & Co.", brandCategory: "Any store",
    tags: ["Post-purchase", "No discount", "Video"], discount: 0,
    subject: "Getting the most out of your order",
    preview: "Three things worth knowing before it arrives.",
    brand: { logoText: "NORTHHILL & CO.", accent: "#1F3D2F", bg: "#FDFBF5", ink: "#14201A", subInk: "#5C625A", onAccent: "#FAF6EC", fontPair: "editorial" },
    blocks: [
      sp(28), lo("NORTHHILL & CO.", "small", "center"), sp(24),
      h("While you wait.", 1, "center"), sp(12),
      pa("Your order is on its way. Three things worth knowing so it lasts as long as it should:", "center"), sp(16),
      li("Wash cold, dry flat — it keeps its shape for years\nThe linen softens after three washes; that's meant to happen\nAnything wrong, reply to this email and we'll sort it", "number"), sp(20),
      vi("Watch: caring for linen (90 seconds)"), sp(24),
      btn("Read the full care guide", "outline", "center"), sp(32),
      ft("Northhill & Co.", "142 Mercer St, New York, NY 10012"),
    ],
  },

  "post-review-request": {
    id: "post-review-request", journey: "post", vibeGroup: "modernist",
    name: "How Did We Do?", vibe: "Modernist · One ask",
    oneliner: "A single question and one button. Reviews are the cheapest conversion lift there is.",
    brandPersona: "OPUS", brandCategory: "Any business",
    tags: ["Reviews", "No discount", "One ask"], discount: 0,
    subject: "How did we do, {first_name}?",
    preview: "Two minutes, and it genuinely helps.",
    brand: { logoText: "OPUS", accent: "#1F3D2F", bg: "#FFFFFF", ink: "#0E0E0E", subInk: "#5A5A5A", onAccent: "#FFFFFF", fontPair: "modern" },
    blocks: [
      sp(28), lo("OPUS", "small", "center"), sp(20),
      h("How did we do?", 1, "center"), sp(10),
      pa("You've had your order a couple of weeks now. If it's working out — or if it isn't — we'd genuinely like to know.", "center"), sp(20),
      btn("Leave a review", "filled", "center"), sp(14),
      pa("Something not right? Reply to this email instead and we'll fix it before you write anything.", "center"), sp(28),
      ft("Opus Design Co.", "88 Bridge St, Brooklyn, NY 11201"),
    ],
  },

  "post-pairs-well": {
    id: "post-pairs-well", journey: "post", vibeGroup: "bold",
    name: "Pairs Well With", vibe: "Bold · Cross-sell",
    oneliner: "The second-order email: what people usually buy next, shown plainly.",
    brandPersona: "ATELIER 84", brandCategory: "Streetwear · DTC",
    tags: ["Cross-sell", "Product grid", "Second order"], discount: 10,
    subject: "Goes with what you just bought",
    preview: "What people usually pick up next.",
    brand: { logoText: "ATELIER 84", accent: "#0E0E0E", bg: "#FFFFFF", ink: "#0E0E0E", subInk: "#5A5A5A", onAccent: "#FFFFFF", fontPair: "brutal" },
    blocks: [
      sp(20), lo("ATELIER 84", "small", "left"), sp(18),
      h("Pairs well with.", 1, "left"), sp(12),
      pa("People who bought what you bought usually pick up one of these next.", "left"), sp(20),
      pr(3, true), sp(20),
      dc("Because you're a customer", 10), sp(20),
      btn("Shop the pairings", "filled", "center"), sp(30),
      ft("Atelier 84", "500 Geary, San Francisco, CA 94102"),
    ],
  },

  // ── WIN-BACK ────────────────────────────────────────────────────────────
  "winback-still-want": {
    id: "winback-still-want", journey: "winback", vibeGroup: "editorial",
    name: "Still Want These?", vibe: "Editorial · Honest",
    oneliner: "A list-hygiene email that asks rather than assumes. Protects your deliverability.",
    brandPersona: "Northhill & Co.", brandCategory: "Any business",
    tags: ["Re-engagement", "No discount", "Deliverability"], discount: 0,
    subject: "Still want to hear from us?",
    preview: "No hard feelings either way.",
    brand: { logoText: "NORTHHILL & CO.", accent: "#1F3D2F", bg: "#FFFFFF", ink: "#14201A", subInk: "#5C625A", onAccent: "#FFFFFF", fontPair: "editorial" },
    blocks: [
      sp(32), h("Still want these letters?", 1, "center"), sp(12),
      pa("We noticed you haven't opened one in a while, which is completely fine — inboxes are full places. But we'd rather send to people who want us there.", "center"), sp(20),
      btn("Yes, keep them coming", "filled", "center"), sp(10),
      pa("If we don't hear from you, we'll quietly stop sending. You can always come back.", "center"), sp(32),
      ft("Northhill & Co.", "142 Mercer St, New York, NY 10012"),
    ],
  },

  "winback-last-chance": {
    id: "winback-last-chance", journey: "winback", vibeGroup: "bold",
    name: "Last Chance", vibe: "Bold · Deadline",
    oneliner: "The final email in a win-back series, with a real deadline and one button.",
    brandPersona: "ATELIER 84", brandCategory: "DTC",
    tags: ["Win-back", "Urgency", "Final email"], discount: 20,
    subject: "Last chance — your 20% expires tonight",
    preview: "After tonight it's gone, and so is this series.",
    brand: { logoText: "ATELIER 84", accent: "#FF3D2E", bg: "#0E0E0E", ink: "#F4EFE4", subInk: "#A8A8A0", onAccent: "#FFFFFF", fontPair: "brutal" },
    blocks: [
      sp(24), lo("ATELIER 84", "small", "left"), sp(18),
      h("Last chance.", 1, "left"), sp(12),
      co("Your 20% code expires at midnight tonight", "Ends tonight"), sp(18),
      pa("This is the last email in this series — after tonight we'll leave you alone.", "left"), sp(16),
      dc("Your final code", 20), sp(20),
      btn("Use it before midnight", "filled", "center"), sp(30),
      ft("Atelier 84", "500 Geary, San Francisco, CA 94102"),
    ],
  },

  // ── NEWSLETTER ──────────────────────────────────────────────────────────
  "news-digest": {
    id: "news-digest", journey: "news", vibeGroup: "editorial",
    name: "The Digest", vibe: "Editorial · Multi-story",
    oneliner: "Two or three stories with images beside the text. The workhorse newsletter layout.",
    brandPersona: "Northhill & Co.", brandCategory: "Any website",
    tags: ["Newsletter", "No discount", "Any website"], discount: 0,
    subject: "The dispatch — issue no. 14",
    preview: "Three things worth your time this week.",
    brand: { logoText: "THE DISPATCH", accent: "#8C3A2A", bg: "#FAF6EC", ink: "#14201A", subInk: "#5C625A", onAccent: "#FAF6EC", fontPair: "editorial" },
    blocks: [
      sp(24), lo("THE DISPATCH", "medium", "center"), sp(8),
      pa("<strong>ISSUE NO. 14 · THURSDAY</strong>", "center"), sp(18),
      di("solid"), sp(18),
      col("The first story", "A sentence or two on what it is and why your reader should care enough to click.", "Read the story", "left"), sp(10),
      di("solid"),
      col("The second story", "Another short summary. Keep each one to two sentences — the click is the goal, not the whole piece.", "Read the story", "right"), sp(10),
      di("solid"),
      col("The third story", "And one more. Three is plenty for a weekly letter that people actually finish.", "Read the story", "left"), sp(22),
      so(["instagram", "linkedin", "website"]), sp(24),
      ft("Northhill & Co.", "142 Mercer St, New York, NY 10012"),
    ],
  },

  "news-one-thing": {
    id: "news-one-thing", journey: "news", vibeGroup: "modernist",
    name: "One Thing", vibe: "Plain text · Personal",
    oneliner: "One idea, written like a letter. The format people reply to — and replies help deliverability.",
    brandPersona: "OPUS", brandCategory: "Any website",
    tags: ["Newsletter", "Plain text", "High reply rate"], discount: 0,
    subject: "One thing this week",
    preview: "A short letter, and a question at the end.",
    brand: { logoText: "", accent: "#1F3D2F", bg: "#FFFFFF", ink: "#14201A", subInk: "#2D362F", onAccent: "#FFFFFF", fontPair: "modern" },
    blocks: [
      sp(36),
      pa("Hi {first_name},", "left"), sp(8),
      pa("One idea this week, and then I'll leave you alone.", "left"), sp(4),
      pa("Write the idea here as if you were emailing one person you like. Three or four short paragraphs is plenty — anything longer and people save it for later, which means never.", "left"), sp(4),
      pa("End with a question. People reply to questions, and replies are the strongest signal there is that your emails belong in the inbox.", "left"), sp(16),
      pa("What are you working on this week?", "left"), sp(16),
      pa("— Anna", "left"), sp(36),
      ft("Opus Design Co.", "88 Bridge St, Brooklyn, NY 11201"),
    ],
  },

  // ── ANNOUNCEMENT ────────────────────────────────────────────────────────
  "announce-launch": {
    id: "announce-launch", journey: "announce", vibeGroup: "bold",
    name: "It's Live", vibe: "Bold · Launch",
    oneliner: "A launch email: one image, one claim, one button. Works with or without a store.",
    brandPersona: "ATELIER 84", brandCategory: "Any business",
    tags: ["Launch", "Announcement", "Any website"], discount: 0,
    subject: "It's live.",
    preview: "The thing we've been working on all year is out today.",
    brand: { logoText: "ATELIER 84", accent: "#1B2BFF", bg: "#FFFFFF", ink: "#0E0E0E", subInk: "#5A5A5A", onAccent: "#FFFFFF", fontPair: "brutal" },
    blocks: [
      sp(20), lo("ATELIER 84", "small", "center"), sp(18),
      im("Hero · the new thing", 300), sp(24),
      h("It's live.", 1, "center"), sp(12),
      pa("The thing we've been working on all year is out today. Here's what's new:", "center"), sp(14),
      li("What it does, in one line\nThe second thing people will care about\nAnd the detail you're most proud of", "check"), sp(20),
      btn("See it now", "filled", "center"), sp(24),
      so(["instagram", "tiktok", "website"]), sp(24),
      ft("Atelier 84", "500 Geary, San Francisco, CA 94102"),
    ],
  },

  "announce-event": {
    id: "announce-event", journey: "announce", vibeGroup: "warm",
    name: "You're Invited", vibe: "Warm · Invitation",
    oneliner: "An invitation with the details impossible to miss. For events, workshops and openings.",
    brandPersona: "Olive & Honey", brandCategory: "Any business",
    tags: ["Event", "Invitation", "Any website"], discount: 0,
    subject: "You're invited — Thursday the 14th",
    preview: "Drinks, a short talk, and the new collection early.",
    brand: { logoText: "olive & honey", accent: "#C7522A", bg: "#F8E8D8", ink: "#4A2E1F", subInk: "#7A4E3A", onAccent: "#F8E8D8", fontPair: "display" },
    blocks: [
      sp(24), lo("olive & honey", "small", "center"), sp(20),
      h("<em>You're invited.</em>", 1, "center"), sp(12),
      pa("We're opening the studio for an evening — drinks, a short talk, and first look at the new collection.", "center"), sp(16),
      co("Thursday 14th · 6–9pm · 142 Mercer St", "Save the date"), sp(18),
      im("Hero · the space", 240), sp(20),
      btn("Save me a spot", "filled", "center"), sp(26),
      ft("Olive & Honey", "PO Box 224, Topanga, CA 90290"),
    ],
  },

  "announce-flash-sale": {
    id: "announce-flash-sale", journey: "announce", vibeGroup: "bold",
    name: "Flash Sale", vibe: "Bold · Coupon",
    oneliner: "A sale email built on a code you set yourself, so it works on any website.",
    brandPersona: "ATELIER 84", brandCategory: "Any business",
    tags: ["Sale", "Coupon code", "Any website"], discount: 0,
    subject: "48 hours only",
    preview: "One code, everything included, ends Sunday night.",
    brand: { logoText: "ATELIER 84", accent: "#E5FF36", bg: "#0E0E0E", ink: "#F4EFE4", subInk: "#A8A8A0", onAccent: "#0E0E0E", fontPair: "brutal" },
    blocks: [
      sp(22), lo("ATELIER 84", "small", "center"), sp(18),
      h("48 hours only.", 1, "center"), sp(12),
      pa("Everything included. No exclusions, no small print, ends Sunday at midnight.", "center"), sp(18),
      cp("FLASH20", "Your code", "20% off everything · ends Sunday midnight"), sp(20),
      btn("Shop the sale", "filled", "center"), sp(26),
      ft("Atelier 84", "500 Geary, San Francisco, CA 94102"),
    ],
  },
};

export const TEMPLATE_ORDER = [
  "welcome-le-salon", "welcome-opus", "welcome-olive-honey", "welcome-what-to-expect", "welcome-first-steps",
  "cart-last-look", "cart-quiet-reminder", "cart-social-proof", "cart-free-shipping",
  "post-thank-you-card", "post-founder-note", "post-how-to-use", "post-review-request", "post-pairs-well",
  "winback-long-time", "winback-something-new", "winback-still-want", "winback-last-chance",
  "birthday-confetti",
  "news-digest", "news-one-thing",
  "announce-launch", "announce-event", "announce-flash-sale",
];

/**
 * Blocks that only work with a Shopify store behind them — see
 * app/components/email-blocks.js. A product grid has no catalogue to draw
 * from without one, and a discount block makes the send worker mint a code in
 * Shopify, which fails the send outright.
 */
const COMMERCE_BLOCKS = new Set(["product", "discount"]);

export function templateNeedsStore(template) {
  return (template?.blocks || []).some((b) => COMMERCE_BLOCKS.has(b.type));
}

/**
 * The templates a workspace can actually send. A workspace with no store is
 * only offered store-free designs: applying one of the others would load a
 * block whose send can only fail.
 */
export function templatesFor(isShopify) {
  const ids = isShopify ? TEMPLATE_ORDER : TEMPLATE_ORDER.filter((id) => !templateNeedsStore(TEMPLATES[id]));
  return ids;
}

// Deep-clone a template's blocks with fresh ids, for loading into the editor.
export function cloneBlocks(template) {
  return template.blocks.map((b) => ({ ...b, id: "b_" + Math.random().toString(36).slice(2, 7) }));
}
