#!/usr/bin/env node
/**
 * Guards the GDPR handlers against schema drift.
 *
 * Every shop-scoped model must be erased by shop/redact, and every model keyed
 * on a shopper's email must be erased by customers/redact and included in the
 * data_request export. Those lists are hand-maintained in gdpr.server.js, so
 * they silently fall behind whenever a model is added — which is exactly what
 * happened with Order, MediaAsset, ContactPropertyDef and ContactView.
 *
 * Run in CI, or before shipping a migration that adds a model.
 *
 *   node scripts/check-gdpr-coverage.mjs
 */
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const gdpr = readFileSync(new URL("../app/lib/privacy/gdpr.server.js", import.meta.url), "utf8");

/**
 * Models removed transitively by a parent's onDelete: Cascade.
 *
 * JourneyPathEvent is listed even though it has no `shop` column and so is
 * never scanned below. That is exactly why it is worth writing down: it holds
 * shopper data (which branch a person took), it is erased only because it
 * cascades from JourneyEnrollment, and nothing here would notice if that
 * cascade were ever dropped. Verified by advance.test.js.
 */
const CASCADE_COVERED = new Set([
  "JourneyStep", "JourneyJob", "PushJob", "WhatsappJob",
  "JourneyEnrollment", "SegmentMembership", "ContactTag",
  "JourneyPathEvent", "JourneyEdge",
]);

/** Session is the merchant's auth, not shopper data — erased by shop/redact only. */
const NOT_SHOPPER_DATA = new Set(["Session"]);

const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
const shopScoped = [];
const emailKeyed = [];
for (const [, name, body] of models) {
  if (!/^\s+shop\s+String/m.test(body)) continue;
  shopScoped.push(name);
  if (/^\s+(email|customerEmail|contactEmail)\s+String/m.test(body)) emailKeyed.push(name);
}

const section = (start, end) => {
  const a = gdpr.indexOf(start);
  const b = end ? gdpr.indexOf(end) : gdpr.length;
  if (a === -1) throw new Error(`could not find ${start} in gdpr.server.js`);
  return gdpr.slice(a, b === -1 ? gdpr.length : b);
};

const collect = section("export async function collectCustomerData", "export async function redactCustomer");
const redactCust = section("export async function redactCustomer", "export async function redactShop");
const redactShop = section("export async function redactShop");

const touches = (model, text) => text.includes(`prisma.${model[0].toLowerCase()}${model.slice(1)}.`);

const problems = [];
for (const m of shopScoped) {
  if (CASCADE_COVERED.has(m)) continue;
  if (!touches(m, redactShop)) problems.push(`shop/redact does not erase ${m}`);
}
for (const m of emailKeyed) {
  if (CASCADE_COVERED.has(m) || NOT_SHOPPER_DATA.has(m)) continue;
  if (!touches(m, redactCust)) problems.push(`customers/redact does not erase ${m}`);
  if (!touches(m, collect)) problems.push(`data_request export omits ${m}`);
}

console.log(`Checked ${shopScoped.length} shop-scoped models (${emailKeyed.length} keyed on a shopper email).`);
if (problems.length) {
  console.error("\nGDPR coverage gaps:");
  for (const p of problems) console.error("  ✗ " + p);
  console.error("\nAdd them to app/lib/privacy/gdpr.server.js, or to the exemption sets in this script if genuinely out of scope.");
  process.exit(1);
}
console.log("✓ every model is covered by all three handlers.");
