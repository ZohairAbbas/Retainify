/**
 * Shared custom-domain action handlers, used by both the Settings route and the
 * onboarding route so the add/verify/check/remove logic lives in one place.
 *
 * Each returns a plain object suitable to return from a route action.
 */
import prisma from "../../db.server.js";
import { createDomain, verifyDomain, getDomain, deleteDomain } from "./resend-domains.server.js";
import { canUseDomainSlot } from "./domain-slots.server.js";

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export async function addDomain(shop, rawDomain) {
  const domain = String(rawDomain || "").trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    return { ok: false, domainError: "Enter a valid domain, e.g. yourbrand.com" };
  }
  if (!(await canUseDomainSlot(shop))) {
    return { ok: false, domainError: "Custom domains are currently full — please contact us." };
  }
  const res = await createDomain(domain);
  if (!res.ok) return { ok: false, domainError: res.error };

  const data = {
    verifiedDomain: domain,
    resendDomainId: res.id,
    domainStatus: res.status,
    domainVerified: false,
    domainRecords: JSON.stringify(res.records),
  };
  await prisma.shopSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
  return { ok: true, domainAdded: true };
}

export async function verifyOrCheckDomain(shop, { verify }) {
  const current = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!current?.resendDomainId) return { ok: false, domainError: "No domain to verify." };

  if (verify) {
    const v = await verifyDomain(current.resendDomainId);
    if (!v.ok) return { ok: false, domainError: v.error };
  }
  const got = await getDomain(current.resendDomainId);
  if (!got.ok) return { ok: false, domainError: got.error };

  let verified = got.status === "verified";
  // Only let a newly-verifying shop take a slot if one is free.
  if (verified && !current.domainVerified && !(await canUseDomainSlot(shop))) {
    verified = false;
  }
  await prisma.shopSettings.update({
    where: { shop },
    data: {
      domainStatus: got.status,
      domainVerified: verified,
      ...(got.records?.length ? { domainRecords: JSON.stringify(got.records) } : {}),
    },
  });
  return { ok: true, domainChecked: true, status: got.status };
}

export async function removeDomain(shop) {
  const current = await prisma.shopSettings.findUnique({ where: { shop } });
  if (current?.resendDomainId) {
    await deleteDomain(current.resendDomainId); // best-effort
  }
  await prisma.shopSettings.update({
    where: { shop },
    data: {
      verifiedDomain: "",
      resendDomainId: "",
      domainStatus: "",
      domainVerified: false,
      domainRecords: "",
      senderEmail: "",
    },
  });
  return { ok: true, domainRemoved: true };
}
