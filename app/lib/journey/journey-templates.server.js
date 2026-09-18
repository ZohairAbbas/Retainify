/**
 * Pre-configured flow templates.
 *
 * Templates are stored in the JourneyTemplate table (seeded once) and referenced
 * by the Create Flow modal. Idempotent — re-running upserts on `key`.
 */
import prisma from "../../db.server.js";
import { FLOW_TEMPLATES } from "./template-library.js";

// The library lives in ./template-library.js, framework-free, so the Create
// Flow modal shows exactly what gets built.
const TEMPLATES = FLOW_TEMPLATES;

// Seeding upserts every template; once per process is enough — it used to run
// on every dashboard and flows page load.
let seeded = false;

export async function seedJourneyTemplates() {
  if (seeded) return;
  seeded = true;
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

/** Every template, straight from the library (the DB copy is a mirror). */
export async function getJourneyTemplates() {
  return TEMPLATES.map((t) => ({ ...t }));
}

export async function getJourneyTemplateByKey(key) {
  const t = TEMPLATES.find((x) => x.key === key);
  if (t) return { ...t };
  // A key only the DB knows (a template retired from the library).
  const row = await prisma.journeyTemplate.findUnique({ where: { key } });
  if (!row) return null;
  return { ...row, bestFor: safeJson(row.bestFor, []), definition: safeJson(row.definition, { steps: [] }) };
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
      // Segment and app-event templates carry what starts them. A segment
      // template without a key is a draft that asks for its segment.
      triggerSegmentKey: tpl.triggerSegmentKey || null,
      triggerApp: tpl.triggerApp || null,
      triggerEvent: tpl.triggerEvent || null,
      status: "draft",
      isActive: false,
      source: "flows",
      entryFrequency: tpl.definition.entryFrequency || "no_reentry",
      exitCriteria: JSON.stringify(tpl.definition.exitCriteria || []),
    },
  });

  // Raw delays, mirroring saveDraft: a Wait stores what it waits for and a
  // send stores nothing. See the note there for why a cumulative figure is a
  // property of a path rather than of a step.
  const rows = [];
  let pos = 0;
  for (const s of tpl.definition.steps || []) {
    if (s.nodeType === "delay") {
      rows.push({
        nodeType: "delay",
        delayHours: Number(s.delayHours) || 0,
        positionY: pos++,
        stepNumber: pos,
      });
    } else if (s.nodeType === "exit") {
      rows.push({ nodeType: "exit", delayHours: 0, positionY: pos++, stepNumber: pos });
    } else if (s.nodeType === "whatsapp") {
      // No template chosen: only the merchant's own Meta-approved templates
      // can be sent, and the builder asks them to pick one.
      rows.push({
        nodeType: "whatsapp", delayHours: 0, positionY: pos++, stepNumber: pos,
        emailName: s.emailName || "", isEnabled: s.isEnabled !== false,
      });
    } else if (s.nodeType === "push") {
      rows.push({
        nodeType: "push", delayHours: 0, positionY: pos++, stepNumber: pos,
        pushTitle: s.pushTitle || "", pushBody: s.pushBody || "", isEnabled: s.isEnabled !== false,
      });
    } else {
      rows.push({
        nodeType: "email",
        delayHours: 0,
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

    // Chain the steps into the flow's graph. Templates are linear and stay that
    // way; a merchant adds branches afterwards in the builder. stepKey is left
    // to the column default — a template instance is a new flow with no history
    // to inherit.
    const live = await prisma.journeyStep.findMany({
      where: { journeyId: journey.id, isArchived: false },
      orderBy: [{ stepNumber: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (live.length > 1) {
      await prisma.journeyEdge.createMany({
        data: live.slice(0, -1).map((s, i) => ({
          journeyId: journey.id,
          fromStepId: s.id,
          toStepId: live[i + 1].id,
          branch: "next",
        })),
      });
    }
  }

  return journey;
}

/**
 * Create an empty draft Journey (Start From Scratch).
 */
export async function createBlankJourney(shop, { name, trigger, triggerSegmentKey } = {}) {
  return prisma.journey.create({
    data: {
      shop,
      name: name || "Untitled Flow",
      trigger: trigger || "customer_created",
      triggerSegmentKey: triggerSegmentKey || null,
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
