/**
 * Pre-configured flow templates.
 *
 * Templates are stored in the JourneyTemplate table (seeded once) and referenced
 * by the Create Flow modal. Idempotent — re-running upserts on `key`.
 */
import prisma from "../../db.server.js";

const TEMPLATES = [
  {
    key: "welcome_series",
    name: "Welcome Series",
    description: "Turn new subscribers into first-time customers with a proven email series.",
    trigger: "customer_created",
    category: "welcome",
    bestFor: [
      "Introducing new subscribers to your brand",
      "Converting subscribers to first-time customers",
      "Establishing regular email touchpoints",
    ],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["order_placed", "unsubscribed"],
      steps: [
        { nodeType: "email", emailName: "Welcome", subject: "Welcome to {store}!", previewText: "We're glad you're here.", templateStyle: "classic", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 48 },
        { nodeType: "email", emailName: "What makes us different", subject: "Here's what makes us different", previewText: "", templateStyle: "classic", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 72 },
        { nodeType: "email", emailName: "First order discount", subject: "Your first order — 10% off", previewText: "A welcome gift from us.", templateStyle: "bold", discountPct: 10, isEnabled: true },
        { nodeType: "exit" },
      ],
    },
  },
  {
    key: "abandoned_cart",
    name: "Abandoned Cart",
    description: "Prevent lost sales through targeted emails when a customer abandons their cart.",
    trigger: "cart_abandoned",
    category: "cart",
    bestFor: [
      "Recovering abandoned checkouts",
      "Reminding shoppers what they left behind",
      "Closing sales with a time-sensitive discount",
    ],
    definition: {
      entryFrequency: "no_reentry",
      exitCriteria: ["order_placed", "cart_recovered", "unsubscribed"],
      steps: [
        { nodeType: "email", emailName: "Reminder", subject: "You left something behind", previewText: "Pick up where you left off.", templateStyle: "classic", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 23 },
        { nodeType: "email", emailName: "Follow-up", subject: "Still thinking it over?", previewText: "", templateStyle: "classic", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 48 },
        { nodeType: "email", emailName: "Last chance", subject: "Last chance — 10% off", previewText: "Your code expires soon.", templateStyle: "bold", discountPct: 10, isEnabled: true },
        { nodeType: "exit" },
      ],
    },
  },
  {
    key: "post_purchase",
    name: "Post-Purchase",
    description: "Build loyalty after a purchase with thank-you, review, and replenishment emails.",
    trigger: "order_placed",
    category: "post_purchase",
    bestFor: [
      "Thanking customers after an order",
      "Collecting reviews and feedback",
      "Driving repeat purchases on consumables",
    ],
    definition: {
      entryFrequency: "immediate",
      exitCriteria: ["unsubscribed"],
      steps: [
        { nodeType: "email", emailName: "Thank you", subject: "Thank you for your order!", previewText: "", templateStyle: "classic", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 70 },
        { nodeType: "email", emailName: "Review request", subject: "How's your order? Leave a review", previewText: "", templateStyle: "minimal", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 264 },
        { nodeType: "email", emailName: "Replenish", subject: "Time to restock?", previewText: "Save 15% on your next order.", templateStyle: "bold", discountPct: 15, isEnabled: true },
        { nodeType: "exit" },
      ],
    },
  },
  {
    key: "winback",
    name: "Customer Win-back",
    description: "Re-engage customers who haven't purchased in a while and bring them back.",
    trigger: "win_back",
    category: "winback",
    bestFor: [
      "Re-engaging dormant customers",
      "Driving repeat purchase",
      "Cleaning your list of disengaged contacts",
    ],
    definition: {
      entryFrequency: "delayed_2160",
      exitCriteria: ["order_placed", "unsubscribed"],
      steps: [
        { nodeType: "email", emailName: "We miss you", subject: "We miss you!", previewText: "It's been a while.", templateStyle: "classic", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 72 },
        { nodeType: "email", emailName: "Reminder", subject: "Still thinking about us?", previewText: "", templateStyle: "classic", discountPct: 0, isEnabled: true },
        { nodeType: "delay", delayHours: 96 },
        { nodeType: "email", emailName: "Offer", subject: "Come back — 15% off, just for you", previewText: "A welcome-back gift.", templateStyle: "bold", discountPct: 15, isEnabled: true },
        { nodeType: "exit" },
      ],
    },
  },
];

export async function seedJourneyTemplates() {
  for (const t of TEMPLATES) {
    await prisma.journeyTemplate.upsert({
      where: { key: t.key },
      create: {
        key: t.key,
        name: t.name,
        description: t.description,
        trigger: t.trigger,
        category: t.category,
        bestFor: JSON.stringify(t.bestFor),
        definition: JSON.stringify(t.definition),
      },
      update: {
        name: t.name,
        description: t.description,
        trigger: t.trigger,
        category: t.category,
        bestFor: JSON.stringify(t.bestFor),
        definition: JSON.stringify(t.definition),
      },
    });
  }
}

export async function getJourneyTemplates() {
  const rows = await prisma.journeyTemplate.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    ...r,
    bestFor: safeJson(r.bestFor, []),
    definition: safeJson(r.definition, { steps: [] }),
  }));
}

export async function getJourneyTemplateByKey(key) {
  const row = await prisma.journeyTemplate.findUnique({ where: { key } });
  if (!row) return null;
  return {
    ...row,
    bestFor: safeJson(row.bestFor, []),
    definition: safeJson(row.definition, { steps: [] }),
  };
}

/**
 * Create a new Journey + steps from a template definition.
 */
export async function createJourneyFromTemplate(shop, templateKey, overrides = {}) {
  const tpl = await getJourneyTemplateByKey(templateKey);
  if (!tpl) throw new Error(`Unknown template: ${templateKey}`);

  const journey = await prisma.journey.create({
    data: {
      shop,
      name: overrides.name || tpl.name,
      trigger: tpl.trigger,
      status: "draft",
      isActive: false,
      source: "flows",
      entryFrequency: tpl.definition.entryFrequency || "no_reentry",
      exitCriteria: JSON.stringify(tpl.definition.exitCriteria || []),
    },
  });

  // Persist steps with cumulative delay accumulation (mirrors saveDraft)
  let cumulative = 0;
  const rows = [];
  let pos = 0;
  for (const s of tpl.definition.steps || []) {
    if (s.nodeType === "delay") {
      cumulative += Number(s.delayHours) || 0;
      rows.push({
        nodeType: "delay",
        delayHours: Number(s.delayHours) || 0,
        positionY: pos++,
        stepNumber: pos,
      });
    } else if (s.nodeType === "exit") {
      rows.push({ nodeType: "exit", delayHours: 0, positionY: pos++, stepNumber: pos });
    } else {
      rows.push({
        nodeType: "email",
        delayHours: cumulative,
        positionY: pos++,
        stepNumber: pos,
        subject: s.subject || "",
        previewText: s.previewText || "",
        emailName: s.emailName || "",
        templateStyle: s.templateStyle || "classic",
        discountPct: Number(s.discountPct) || 0,
        isEnabled: s.isEnabled !== false,
      });
    }
  }

  if (rows.length) {
    await prisma.journeyStep.createMany({
      data: rows.map((r) => ({ journeyId: journey.id, ...r })),
    });
  }

  return journey;
}

/**
 * Create an empty draft Journey (Start From Scratch).
 */
export async function createBlankJourney(shop, { name, trigger } = {}) {
  return prisma.journey.create({
    data: {
      shop,
      name: name || "Untitled Flow",
      trigger: trigger || "customer_created",
      status: "draft",
      isActive: false,
      source: "flows",
      entryFrequency: "no_reentry",
      exitCriteria: "[]",
    },
  });
}

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
