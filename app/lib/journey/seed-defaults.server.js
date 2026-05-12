/**
 * Creates default journeys for a shop if they don't exist yet.
 * Called from the dashboard loader — idempotent.
 */
import prisma from "../../db.server.js";

const DEFAULT_JOURNEYS = [
  {
    name: "Welcome Series",
    trigger: "customer_created",
    steps: [
      { stepNumber: 1, delayHours: 0, subject: "Welcome! Here's what makes us different", templateStyle: "classic", discountPct: 0 },
      { stepNumber: 2, delayHours: 48, subject: "Here's what makes us different", templateStyle: "classic", discountPct: 0 },
      { stepNumber: 3, delayHours: 120, subject: "Your first order — 10% off", templateStyle: "classic", discountPct: 10 },
    ],
  },
  {
    name: "Post-Purchase",
    trigger: "order_placed",
    steps: [
      { stepNumber: 1, delayHours: 2, subject: "Thank you for your order!", templateStyle: "classic", discountPct: 0 },
      { stepNumber: 2, delayHours: 72, subject: "How's your order? Leave a review", templateStyle: "classic", discountPct: 0 },
      { stepNumber: 3, delayHours: 336, subject: "Time to restock?", templateStyle: "classic", discountPct: 15 },
    ],
  },
  {
    name: "Win-Back",
    trigger: "win_back",
    steps: [
      { stepNumber: 1, delayHours: 0, subject: "We miss you!", templateStyle: "classic", discountPct: 0 },
      { stepNumber: 2, delayHours: 72, subject: "Still thinking about us?", templateStyle: "classic", discountPct: 0 },
      { stepNumber: 3, delayHours: 168, subject: "Come back — 15% off, just for you", templateStyle: "classic", discountPct: 15 },
    ],
  },
];

export async function ensureDefaultJourneys(shop) {
  for (const def of DEFAULT_JOURNEYS) {
    const existing = await prisma.journey.findFirst({ where: { shop, trigger: def.trigger } });
    if (existing) continue;

    await prisma.journey.create({
      data: {
        shop,
        name: def.name,
        trigger: def.trigger,
        isActive: false,
        steps: {
          create: def.steps.map((s) => ({
            stepNumber: s.stepNumber,
            delayHours: s.delayHours,
            subject: s.subject,
            templateStyle: s.templateStyle,
            discountPct: s.discountPct,
            isEnabled: true,
          })),
        },
      },
    });
  }
}
