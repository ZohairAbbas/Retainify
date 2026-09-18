/**
 * Can this workspace send WhatsApp right now — and if not, what is the ONE
 * thing to fix next?
 *
 * The flow builder, the flows list and publish validation all ask this, and
 * they used to answer it separately (or not at all): the builder showed "No
 * approved templates yet" for every problem, including "no account connected",
 * and a flow whose channel was later switched off went on running with every
 * WhatsApp step silently skipped. One answer, in one place, is what lets every
 * surface say the same true thing and point at the same fix.
 *
 * `problem` is ordered — the first unmet requirement wins, because that is the
 * step the merchant has to take next:
 *
 *   not_connected   no WhatsApp Business account connected
 *   blocked         Meta is refusing sends for the whole account
 *   disabled        connected, but the channel switch is off
 *   no_templates    nothing approved to send yet
 *   null            ready
 *
 * Deliberately not a blocker: a missing registeredAt. Numbers registered in
 * WhatsApp Manager and every Meta test number send fine without our stamp; the
 * WhatsApp page reconciles it with Meta on load.
 */
import prisma from "../../db.server.js";
import { sendBlockedReason } from "./index.server.js";

export { WHATSAPP_PROBLEMS } from "./problems.js";

/**
 * @param {string} shop
 * @returns {Promise<{
 *   ready: boolean, problem: string|null, connected: boolean, enabled: boolean,
 *   blockedReason: string, displayPhoneNumber: string|null,
 *   approvedTemplates: number, pendingTemplates: number,
 * }>}
 */
export async function whatsappReadiness(shop) {
  const [account, settings, byStatus] = await Promise.all([
    prisma.whatsappAccount.findUnique({
      where: { shop },
      select: { status: true, lastError: true, displayPhoneNumber: true },
    }),
    prisma.shopSettings.findUnique({ where: { shop }, select: { whatsappEnabled: true } }),
    prisma.whatsappTemplate.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
  ]);
  const count = (s) => byStatus.find((r) => r.status === s)?._count._all || 0;

  const connected = account?.status === "connected";
  const enabled = Boolean(settings?.whatsappEnabled);
  const blockedReason = connected ? sendBlockedReason(account) : "";
  const approvedTemplates = count("APPROVED");
  const pendingTemplates = count("PENDING");

  let problem = null;
  if (!connected) problem = "not_connected";
  else if (blockedReason) problem = "blocked";
  else if (!enabled) problem = "disabled";
  else if (approvedTemplates === 0) problem = "no_templates";

  return {
    ready: problem === null,
    problem,
    connected,
    enabled,
    blockedReason,
    displayPhoneNumber: account?.displayPhoneNumber || null,
    approvedTemplates,
    pendingTemplates,
  };
}

/**
 * Published flows with at least one enabled WhatsApp step — the ones a
 * channel problem is silently breaking right now.
 */
export async function flowsUsingWhatsapp(shop) {
  return prisma.journey.findMany({
    where: {
      shop,
      status: "published",
      archivedAt: null,
      steps: { some: { nodeType: "whatsapp", isEnabled: true, isArchived: false } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
